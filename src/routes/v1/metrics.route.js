const express = require('express');
const os = require('os');
const router = express.Router();

router.get('/', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    uptime: process.uptime(),
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
    },
    cpu: os.cpus().length,
    loadAvg: os.loadavg(),
    platform: os.platform(),
    nodeVersion: process.version,
  });
});

module.exports = router;
