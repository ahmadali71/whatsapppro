let mainModule = null;
let loadError = null;

try {
  mainModule = require('../dist/src/main');
} catch (err) {
  loadError = err;
}

module.exports = async (req, res) => {
  if (loadError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'SERVER_MODULE_LOAD_FAILED',
        message: loadError instanceof Error ? loadError.message : String(loadError),
        stack: loadError instanceof Error ? loadError.stack : undefined,
      }),
    );
    return;
  }

  try {
    const server = await mainModule.getServer();
    return server(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'SERVER_BOOT_FAILED',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
  }
};
