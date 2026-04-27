import http from 'node:http'

const port = Number(process.env.PORT ?? 3000)

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Brimble Mini Sample</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f7f2;
        color: #18201c;
      }
      main {
        width: min(680px, calc(100vw - 32px));
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(2rem, 5vw, 4rem);
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: #4d5a52;
        font-size: 1.1rem;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Sample app is running</h1>
      <p>This Node app was built by Railpack, started by Docker, and routed through Caddy by the Brimble Mini control plane.</p>
    </main>
  </body>
</html>`)
})

server.listen(port, '0.0.0.0', () => {
  console.log(`sample app listening on ${port}`)
})
