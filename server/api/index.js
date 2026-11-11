const { getServer } = require('../dist/src/main');

module.exports = async (req, res) => {
  const server = await getServer();
  return server(req, res);
};
