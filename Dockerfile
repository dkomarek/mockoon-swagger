FROM mockoon/cli:latest

WORKDIR /app

RUN npm install @apidevtools/json-schema-ref-parser

ADD openapi.json ./
ADD create-mockoon-spec.js ./

# Convert swagger to mockoon data file
RUN mockoon-cli import --input openapi.json --output /app/mockoon.json --prettify

# Replace response examples in mockoon data file and add validation rules
RUN node create-mockoon-spec.js --openapi openapi.json --mockoon mockoon.json

ENTRYPOINT ["mockoon-cli", "start", "--data", "mockoon.json", "--port", "8080", "--log-transaction", "--watch", "--disable-log-to-file"]
