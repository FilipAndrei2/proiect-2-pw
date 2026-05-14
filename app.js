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

function insertProdus(name, price) {
  cumparaturiDb.prepare(`
    INSERT INTO produse(name, price) VALUES(?, ?);
  `).run(name, price);
}

function createProduseTable() {
  cumparaturiDb.prepare(`
    CREATE TABLE IF NOT EXISTS produse (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL
    );
    `).run();
}

app.get('/', (req, res) => {
  res.render('index',  { produse: getProduse() }  );
});

app.get('/autentificare', (req, res) => {
  res.render('autentificare');
});

app.get('/create-db', (req, res) => {
  console.log("Create db");
  
  createProduseTable();
  
  res.render('index',  { produse: getProduse() } );
});

app.get('/insert-db', (req, res) => {
  console.log("Insert db");

  insertProdus("Honda Civic", 67);
  
  res.render('index',  { produse: getProduse() } );
});

app.listen(port, () => {
  console.log(`Serverul ruleaza pe http://localhost:${port}`);
});
