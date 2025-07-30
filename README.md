# Mockoon Swagger mock
How to create mock from swagger openapi file via mockoon.

## Build image
`docker build -t mockoon-swagger .`

## Start mock
`docker run -p 8080:8080 mockoon-swagger`

## Test
`curl -i http://localhost:8080/users`
