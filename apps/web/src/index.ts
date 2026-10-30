import { Hono } from "hono";
import { contentSecurityPolicy, type SecurityVariables } from "./security";

const app = new Hono<{ Variables: SecurityVariables }>();

app.use(contentSecurityPolicy);

app.notFound((c) =>
  c.html(
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · rarepair</title></head>
<body><main><h1>Page not found</h1><p><a href="/">Back to rarepair</a></p></main></body>
</html>`,
    404,
  ),
);

export default app;
