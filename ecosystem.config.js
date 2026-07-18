module.exports = {
  apps: [{
    name: 'blades-of-hex',
    script: 'server.js',
    env: {
      BOH_SERVE_DIST: '1'
    }
  }]
};
