const jwt = require('./node_modules/.pnpm/jsonwebtoken@9.0.2/node_modules/jsonwebtoken/index.js');
console.log(jwt.sign({ userId: '123', email: 'test@gmail.com', tenantId: undefined, role: undefined }, 'secret'));
