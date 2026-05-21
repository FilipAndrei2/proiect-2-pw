const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const bcrypt = require('bcypt');
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

class User {
  public constructor(username, hashedPassword) {
    this.username = username;
    this.hashedPassword = hashedPassword;

    Object.freeze(this); // Pentru a face obiectul immutable
  }

  public static async function hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  public function validate() {
    if (typeof this.username !== 'string' || typeof this.password !== 'number') {
      throw new TypeError("User.validate(): campurile nu sunt de tipurile dorite");
    }

    if (this.username === "") {
      throw new TypeError("User.validate(): username nu poate sa fie empty");
    }
}

function validateProdus(name, price) {
  if (name == null || name === "" || typeof name !== "string" || price == null || typeof price !== "number" || price <= 0) {
    throw new TypeError("Se incearca inserarea in baza de date a unui produs invalid!");
  }
}

function insertProdus(name, price) {
  // Validari 
  validateProdus(name, price);

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

function createUsersTable() {
  cumparaturiDb.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      user_name TEXT NOT NULL PRIMARY KEY,
      hashed_password INTEGER NOT NULL
    );
  `).run();
}

function insertUser(user) {
  if (typeof user !== "User") {
    throw new TypeError("insertUser(): user nu este obiect al clasei User!");
  }
  user.validate();

  cumparaturiDb.prepare(`
    INSERT INTO users VALUES(?, ?);
  `).run(user.username, user.hashedPassword);
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
