const routes = require('./src/routes/v1/index');
console.log('Routes loaded successfully');
console.log('Number of middleware layers:', routes.stack.length);

routes.stack.forEach((r, i) => {
  const path = r.path || (r.route ? r.route.path : 'no path');
  console.log(`Layer ${i}: path=${path}, handle type=${typeof r.handle}`);
  if (r.route) {
    console.log(`  -> Route path: ${r.route.path}`);
  }
  if (path && path.includes('local')) {
    console.log(`  ** FOUND local-services route **`);
  }
});