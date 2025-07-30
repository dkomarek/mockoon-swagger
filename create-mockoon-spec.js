import fs from 'fs';
import $RefParser from "@apidevtools/json-schema-ref-parser";

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
    const index = args.findIndex(arg => arg === name);
    return index !== -1 ? args[index + 1] : fallback;
};

const openapiPath = getArg('--openapi');
const mockoonPath = getArg('--mockoon');

if (!fs.existsSync(openapiPath) || !fs.existsSync(mockoonPath)) {
    console.error('❌ Input files not found.');
    process.exit(1);
}

const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf-8'));
const mockoon = JSON.parse(fs.readFileSync(mockoonPath, 'utf-8'));

// create buckets
const buckets = [];
const bucketId = "abc123";
const bucketUuid = crypto.randomUUID?.();

// schema dereference (due to refs)
let schemaComponents;
try {
    const openapiDereferenced = await $RefParser.dereference(openapiPath, { mutateInputSchema: false });
    schemaComponents = openapiDereferenced.components?.schemas || {};

    for (const [schemaName, schema] of Object.entries(schemaComponents)) {
        buckets.push({
            uuid: bucketUuid,
            id: bucketId,
            name: schemaName,
            documentation: '',
            value: JSON.stringify(schema)
        });
    }
} catch (err) {
    console.error(err);
    process.exit(1);
}

mockoon.data = buckets;

// replace responses
for (const [path, pathObj] of Object.entries(openapi.paths)) {
    for (const [method, operation] of Object.entries(pathObj)) {
        const responses = operation.responses;
        if (!responses) {
            continue;
        }

        const mockPath = path.replace(/^\/+/, '').replace(/{([^}]+)}/g, ':$1'); // e.g. /users/{id} → /users/:id

        // find route in mockoon json
        const route = mockoon.routes.find(
            r => r.method === method.toLowerCase() && r.endpoint === mockPath
        );

        if (!route || !route.responses?.length) {
            console.warn('No route for method', method, ', operation', mockPath);
            continue;
        }

        for (const [statusCode, swaggerResponse] of Object.entries(responses)) {
            const statusCodeNum = parseInt(statusCode, 10);
            if (isNaN(statusCodeNum)) {
                continue;
            }

            const mockoonResponse = route.responses.find(r => r.statusCode === statusCodeNum);
            if (!mockoonResponse) {
                continue;
            }

            let example = null;

            // find first example
            if (swaggerResponse.content && typeof swaggerResponse.content === 'object') {
                for (const [contentType, contentObj] of Object.entries(swaggerResponse.content)) {
                    if (contentObj.example) {
                        example = contentObj.example;
                        break;
                    }
                }
            }

            mockoonResponse.rules = [{
                target: "header",
                modifier: "X-Mockoon-Response-Status",
                value: statusCode,
                operator: "equals"
            }];
            mockoonResponse.rulesOperator = "OR";

            // rules for invalid request by json schema (validation errors in response -> https://github.com/mockoon/mockoon/issues/1692)
            if (statusCodeNum === 400) {
                const schemaRef = operation.requestBody?.content?.['application/json']?.schema?.$ref?.split('/')?.pop();
                if (schemaRef) {
                    mockoonResponse.databucketID = bucketId;
                    mockoonResponse.rules.push({
                        target: "body",
                        modifier: "",
                        value: schemaRef,
                        operator: "valid_json_schema",
                        invert: true
                    });

                    if (example && schemaComponents[schemaRef]) {
                        example.schema = schemaComponents[schemaRef];
                    }
                }
            }

            if (example) {
                mockoonResponse.body = JSON.stringify(example)
                    .replace(/{{(.*?)}}/gs, (match, inner) => {
                        // remove escapes in {{...}}
                        const unescaped = inner.replace(/\\"/g, '"');
                        return `{{${unescaped}}}`;
                    });
            }
        }
    }
}

fs.writeFileSync(mockoonPath, JSON.stringify(mockoon, null, 2));
console.log(`✅ Updated ${mockoonPath} with swagger responses and rules.`);
