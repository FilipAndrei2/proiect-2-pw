const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const Database = require("better-sqlite3");

const app = express();

const port = 6790;

app.set('view engine', 'ejs');
app.use(expressLayouts);
app.use(express.static('public'));

app.use(bodyParser.json());

const cumparaturiDb = new Database("cumparaturi.db")

function getProduse() {
  return cumparaturiDb.prepare("SELECT * FROM produse").all();
}

app.get('/', (req, res) => {
  const produse = getProduse();
  res.render('index',  { produse }  );
});

app.get('/autentificare', (req, res) => {
  res.render('autentificare');
});

app.get('/create-db', (req, res) => {
  console.log("Create db");
  cumparaturiDb.prepare(`
    CREATE TABLE IF NOT EXISTS produse (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL
    );
    `).run();
  const produse = getProduse();
  res.render('index',  {produse} );
});

app.get('/insert-db', (req, res) => {
  console.log("Insert db");
  cumparaturiDb.prepare(`
    INSERT INTO produse(name, price) VALUES(?, ?);
  `).run("Honda Civic", 67);
  
  const produse = getProduse();
  res.render('index',  { produse } );
});

app.listen(port, () => {
  console.log(`Serverul ruleaza pe http://localhost:${port}`);
});
