const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');

const app = express();

const port = 6790;

app.set('view engine', 'ejs');
app.use(expressLayouts);
app.use(express.static('public'));

app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/autentificare', (req, res) => {
  res.render('autentificare');
});

app.listen(port, () => {
  console.log(`Serverul ruleaza pe http://localhost:${port}`);
});
