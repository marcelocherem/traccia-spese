import express from "express";
import pg from "pg";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import session from "express-session";
import bcrypt from "bcrypt";

dotenv.config();
console.log("DATABASE_URL:", process.env.DATABASE_URL);

const { Pool } = pg;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const app = express();
const port = 3000;
db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.use(session({
  secret: "passwordkey",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dias
  }
}));

// login
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

// logout
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// register area
app.get("/register", (req, res) => {
  res.render("auth", { section: "register", error: null });
});

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query("INSERT INTO users (username, password) VALUES ($1, $2)", [username, hashedPassword]);
    res.redirect("/login");
  } catch (err) {
    res.render("auth", { section: "register", error: "il nome utente esiste già." });
  }
});

// login area
app.get("/login", (req, res) => {
  res.render("auth", { section: "login", error: null });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const result = await db.query("SELECT * FROM users WHERE username = $1", [username]);

  if (result.rows.length === 0) {
    return res.render("auth", { section: "login", error: "nome utente non trovato." });
  }

  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password);

  if (match) {
    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect("/");
  } else {
    res.render("auth", { section: "login", error: "password errata." });
  }
});

// home page
app.get("/", requireLogin, async (req, res) => {
  try {
    const username = req.session.username;

    // Semana atual (segunda a domingo)
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const weekLabel = `${weekStart.toLocaleDateString("it-IT", { day: '2-digit', month: 'short' })} - ${weekEnd.toLocaleDateString("it-IT", { day: '2-digit', month: 'short' })}`;

    // Semana anterior
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(weekStart.getDate() - 7);
    prevWeekStart.setHours(0, 0, 0, 0);

    const prevWeekEnd = new Date(prevWeekStart);
    prevWeekEnd.setDate(prevWeekStart.getDate() + 6);
    prevWeekEnd.setHours(23, 59, 59, 999);

    // Buscar salários válidos na semana anterior
    const prevSalaryRes = await db.query(`
      SELECT value, date_created FROM family
      WHERE username = $1 AND $2 BETWEEN date_created AND COALESCE(date_end, 'infinity')
    `, [username, prevWeekStart]);

    const prevSalaryValues = prevSalaryRes.rows.map(s => parseFloat(s.value));
    const prevTotalIncome = prevSalaryValues.length > 0
      ? prevSalaryValues.reduce((acc, val) => acc + val, 0)
      : 0;

    const prevSalaryStartDate = prevSalaryRes.rows[0]?.date_created
      ? new Date(prevSalaryRes.rows[0].date_created)
      : null;

    let prevTotalWeeks = 4;
    if (prevSalaryStartDate) {
      const year = prevSalaryStartDate.getFullYear();
      const month = prevSalaryStartDate.getMonth();
      const salaryEndDate = new Date(year, month + 1, 13);
      const diffDays = Math.ceil((salaryEndDate - prevSalaryStartDate) / (1000 * 60 * 60 * 24));
      prevTotalWeeks = Math.ceil(diffDays / 7);
    }

    const prevBillsRes = await db.query("SELECT value FROM bills WHERE username = $1", [username]);
    const prevBillValues = prevBillsRes.rows.map(b => parseFloat(b.value));
    const prevTotalBills = prevBillValues.length > 0
      ? prevBillValues.reduce((acc, val) => acc + val, 0)
      : 0;

    const prevWeeklyLimit = (prevTotalIncome - prevTotalBills) / prevTotalWeeks;

    const prevExpensesRes = await db.query(`
      SELECT SUM(value) FROM weekly_expenses
      WHERE username = $1 AND date_expense BETWEEN $2 AND $3
    `, [username, prevWeekStart, prevWeekEnd]);

    const prevTotalSpent = parseFloat(prevExpensesRes.rows[0].sum) || 0;
    const prevRemaining = prevWeeklyLimit - prevTotalSpent;

    // Atualizar ou inserir resumo da semana anterior
    const prevSummaryCheck = await db.query(`
      SELECT id FROM weekly_summary
      WHERE username = $1 AND period_start = $2 AND period_end = $3
    `, [username, prevWeekStart, prevWeekEnd]);

    if (prevSummaryCheck.rows.length === 0) {
      await db.query(`
        INSERT INTO weekly_summary (username, period_start, period_end, weekly_limit, total_spent, remaining)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [username, prevWeekStart, prevWeekEnd, prevWeeklyLimit, prevTotalSpent, prevRemaining]);
    } else {
      await db.query(`
        UPDATE weekly_summary
        SET weekly_limit = $1, total_spent = $2, remaining = $3
        WHERE id = $4
      `, [prevWeeklyLimit, prevTotalSpent, prevRemaining, prevSummaryCheck.rows[0].id]);
    }

    // Aplicar retifica se necessário
    const correctionCheck = await db.query(`
      SELECT COUNT(*) FROM weekly_expenses
      WHERE username = $1 AND name = $2
      AND date_expense BETWEEN $3 AND $4
    `, [username, "rettifica settimana precedente", weekStart, weekEnd]);

    const alreadyInserted = parseInt(correctionCheck.rows[0].count) > 0;

    if (!alreadyInserted && prevRemaining !== 0) {
      const correctionValue = Math.abs(prevRemaining);
      const correctionSign = prevRemaining < 0 ? correctionValue : -correctionValue;

      const sundayPrev = new Date(prevWeekEnd);
      const mondayCurrent = new Date(weekStart);

      await db.query(
        "INSERT INTO weekly_expenses (name, value, date_expense, username) VALUES ($1, $2, $3, $4)",
        ["rettifica settimana precedente", correctionSign, mondayCurrent, username]
      );

      await db.query(
        "INSERT INTO weekly_expenses (name, value, date_expense, username) VALUES ($1, $2, $3, $4)",
        ["rettifica settimana precedente", -correctionSign, sundayPrev, username]
      );
    }

    // Semana atual: salários, contas, limite
    const salaryRes = await db.query(`
      SELECT value, date_created FROM family
      WHERE username = $1 AND $2 BETWEEN date_created AND COALESCE(date_end, 'infinity')
    `, [username, weekStart]);

    const salaryValues = salaryRes.rows.map(s => parseFloat(s.value));
    const totalIncome = salaryValues.length > 0
      ? salaryValues.reduce((acc, val) => acc + val, 0)
      : 0;

    const salaryStartDate = salaryRes.rows[0]?.date_created
      ? new Date(salaryRes.rows[0].date_created)
      : null;

    let totalWeeks = 4;
    if (salaryStartDate) {
      const year = salaryStartDate.getFullYear();
      const month = salaryStartDate.getMonth();
      const salaryEndDate = new Date(year, month + 1, 13);
      const diffDays = Math.ceil((salaryEndDate - salaryStartDate) / (1000 * 60 * 60 * 24));
      totalWeeks = Math.ceil(diffDays / 7);
    }

    const billsRes = await db.query("SELECT value FROM bills WHERE username = $1", [username]);
    const billValues = billsRes.rows.map(b => parseFloat(b.value));
    const totalBills = billValues.length > 0
      ? billValues.reduce((acc, val) => acc + val, 0)
      : 0;

    const weeklyLimit = (totalIncome - totalBills) / totalWeeks;

    const expensesRes = await db.query(`
      SELECT id, name, value, date_expense FROM weekly_expenses
      WHERE username = $1 AND date_expense BETWEEN $2 AND $3
      ORDER BY date_expense DESC
    `, [username, weekStart, weekEnd]);

    const expenses = expensesRes.rows.map(exp => ({
      ...exp,
      value: parseFloat(exp.value)
    }));

    const totalSpent = expenses.reduce((acc, exp) => acc + exp.value, 0);
    const remainingBudget = weeklyLimit - totalSpent;

    const summaryCheck = await db.query(`
      SELECT id FROM weekly_summary
      WHERE username = $1 AND period_start = $2 AND period_end = $3
    `, [username, weekStart, weekEnd]);

    if (summaryCheck.rows.length === 0) {
      await db.query(`
        INSERT INTO weekly_summary (username, period_start, period_end, weekly_limit, total_spent, remaining)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [username, weekStart, weekEnd, weeklyLimit, totalSpent, remainingBudget]);
    } else {
      await db.query(`
        UPDATE weekly_summary
        SET weekly_limit = $1, total_spent = $2, remaining = $3
        WHERE id = $4
      `, [weeklyLimit, totalSpent, remainingBudget, summaryCheck.rows[0].id]);
    }

    res.render("index", {
      section: "home",
      expenses,
      total: totalSpent,
      limit: weeklyLimit,
      remaining: remainingBudget,
      weekLabel
    });

  } catch (err) {
    console.error("Erro ao carregar página inicial:", err.message);
    res.status(500).send("Erro interno: " + err.message);
  }
});


// adding new weekly expense
// ADD weekly expense
app.post("/add-weekly_expenses", requireLogin, async (req, res) => {
  const { name, value, date_expense } = req.body;
  const username = req.session.username;

  try {
    const parsedValue = parseFloat(value);
    const expenseDate = new Date(date_expense);

    // Inserir despesa
    await db.query(
      "INSERT INTO weekly_expenses (name, value, date_expense, username) VALUES ($1, $2, $3, $4)",
      [name, parsedValue, expenseDate, username]
    );

    // Calcular semana da despesa
    const dayOfWeek = expenseDate.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const weekStart = new Date(expenseDate);
    weekStart.setDate(expenseDate.getDate() + diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Buscar salários válidos no início da semana
    const salaryRes = await db.query(`
      SELECT value, date_created FROM family
      WHERE username = $1 AND $2 BETWEEN date_created AND COALESCE(date_end, 'infinity')
    `, [username, weekStart]);

    const salaryValues = salaryRes.rows.map(s => parseFloat(s.value));
    const totalIncome = salaryValues.reduce((acc, val) => acc + val, 0);

    // Calcular número de semanas entre data do salário e 13 do mês seguinte
    let totalWeeks = 4;
    if (salaryRes.rows.length > 0) {
      const salaryStartDate = new Date(salaryRes.rows[0].date_created);
      const year = salaryStartDate.getFullYear();
      const month = salaryStartDate.getMonth();
      const salaryEndDate = new Date(year, month + 1, 13);

      const diffDays = Math.ceil((salaryEndDate - salaryStartDate) / (1000 * 60 * 60 * 24));
      totalWeeks = Math.ceil(diffDays / 7);
    }

    // Buscar contas fixas
    const billsRes = await db.query("SELECT value FROM bills WHERE username = $1", [username]);
    const billValues = billsRes.rows.map(b => parseFloat(b.value));
    const totalBills = billValues.reduce((acc, val) => acc + val, 0);

    // Calcular limite semanal
    const weeklyLimit = (totalIncome - totalBills) / totalWeeks;

    // Somar gastos da semana
    const expensesRes = await db.query(`
      SELECT SUM(value) FROM weekly_expenses
      WHERE username = $1 AND date_expense BETWEEN $2 AND $3
    `, [username, weekStart, weekEnd]);

    const totalSpent = parseFloat(expensesRes.rows[0].sum) || 0;
    const remaining = weeklyLimit - totalSpent;

    // Inserir ou atualizar weekly_summary
    const summaryExists = await db.query(`
      SELECT COUNT(*) FROM weekly_summary
      WHERE username = $1 AND period_start = $2 AND period_end = $3
    `, [username, weekStart, weekEnd]);

    if (parseInt(summaryExists.rows[0].count) === 0) {
      await db.query(`
        INSERT INTO weekly_summary (username, period_start, period_end, weekly_limit, total_spent, remaining)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [username, weekStart, weekEnd, weeklyLimit, totalSpent, remaining]);
    } else {
      await db.query(`
        UPDATE weekly_summary
        SET weekly_limit = $1, total_spent = $2, remaining = $3
        WHERE username = $4 AND period_start = $5 AND period_end = $6
      `, [weeklyLimit, totalSpent, remaining, username, weekStart, weekEnd]);
    }

    res.redirect("/");
  } catch (err) {
    console.error("Erro ao adicionar despesa:", err.message);
    res.status(500).send("Erro interno");
  }
});


// EDIT weekly expense
app.post("/edit-weekly_expenses/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const { name, value, date_expense } = req.body;
  const username = req.session.username;

  try {
    const check = await db.query("SELECT username FROM weekly_expenses WHERE id = $1", [id]);
    if (check.rows[0]?.username !== username) return res.status(403).send("Acesso negado.");

    await db.query(
      "UPDATE weekly_expenses SET name = $1, value = $2, date_expense = $3 WHERE id = $4",
      [name, parseFloat(value), date_expense, id]
    );
    res.redirect("/");
  } catch (err) {
    console.error("Error editing expense:", err.message);
    res.status(500).send("Internal server error");
  }
});

// DELETE weekly expense
app.post("/delete-weekly_expenses/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const username = req.session.username;

  try {
    const check = await db.query("SELECT username FROM weekly_expenses WHERE id = $1", [id]);
    if (check.rows[0]?.username !== username) return res.status(403).send("Acesso negado.");

    await db.query("DELETE FROM weekly_expenses WHERE id = $1", [id]);
    res.redirect("/");
  } catch (err) {
    console.error("Error deleting expense:", err.message);
    res.status(500).send("Internal server error");
  }
});

// FAMILY page
app.get("/family", requireLogin, async (req, res) => {
  const username = req.session.username;
  try {
    const result = await db.query(
      "SELECT id, name, value, date_created, date_end FROM family WHERE username = $1 ORDER BY date_created DESC",
      [username]
    );
    const family = result.rows.map(item => ({
      ...item,
      value: parseFloat(item.value)
    }));

    const total = family.reduce((acc, item) => acc + item.value, 0);

    res.render("index", {
      section: "family",
      family,
      total
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send("Intern error");
  }
});

// ADD family member
app.post("/add-family", requireLogin, async (req, res) => {
  const { name, value, date_created } = req.body;
  const username = req.session.username;

  try {
    // end last salary
    await db.query(
      "UPDATE family SET date_end = $1 WHERE username = $2 AND date_end IS NULL",
      [date_created, username]
    );

    // Insert new salary
    await db.query(
      "INSERT INTO family (name, value, date_created, username) VALUES ($1, $2, $3, $4)",
      [name, value, date_created, username]
    );

    res.redirect("/family");
  } catch (err) {
    console.error("Error :", err.message);
    res.status(500).send("Intern error");
  }
});


// EDIT family member
app.post("/edit-family/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const { name, value, date_created } = req.body;
  const username = req.session.username;

  const check = await db.query("SELECT username FROM family WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Acesso negado.");

  await db.query(
    "UPDATE family SET name = $1, value = $2, date_created = $3 WHERE id = $4",
    [name, value, date_created, id]
  );
  res.redirect("/family");
});

// DELETE family member
app.post("/delete-family/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const username = req.session.username;

  const check = await db.query("SELECT username FROM family WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Acesso negado.");

  await db.query("DELETE FROM family WHERE id = $1", [id]);
  res.redirect("/family");
});

// BILLS page
app.get("/bills", requireLogin, async (req, res) => {
  const username = req.session.username;
  try {
    const result = await db.query(
      "SELECT id, name, value, day FROM bills WHERE username = $1 ORDER BY name",
      [username]
    );
    const bills = result.rows.map(item => ({
      ...item,
      value: parseFloat(item.value)
    }));

    const total = bills.reduce((acc, item) => acc + item.value, 0);

    res.render("index", {
      section: "bills",
      bills,
      total
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send("Internal error: " + err.message);
  }
});

// ADD bill
app.post("/add-bill", requireLogin, async (req, res) => {
  const { name, value, day } = req.body;
  const username = req.session.username;

  try {
    await db.query(
      "INSERT INTO bills (name, value, day, username) VALUES ($1, $2, $3, $4)",
      [name, parseFloat(value), parseInt(day), username]
    );
    res.redirect("/bills");
  } catch (err) {
    console.error("Error adding bill:", err.message);
    res.status(500).send("Internal server error");
  }
});

// EDIT bill
app.post("/edit-bill/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const { name, value, day } = req.body;
  const username = req.session.username;

  const check = await db.query("SELECT username FROM bills WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Acesso negado.");

  try {
    await db.query(
      "UPDATE bills SET name = $1, value = $2, day = $3 WHERE id = $4",
      [name, parseFloat(value), parseInt(day), id]
    );
    res.redirect("/bills");
  } catch (err) {
    console.error("Error editing bill:", err.message);
    res.status(500).send("Internal server error");
  }
});

// DELETE bill
app.post("/delete-bill/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const username = req.session.username;

  const check = await db.query("SELECT username FROM bills WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Acesso negado.");

  try {
    await db.query("DELETE FROM bills WHERE id = $1", [id]);
    res.redirect("/bills");
  } catch (err) {
    console.error("Error deleting bill:", err.message);
    res.status(500).send("Internal server error");
  }
});

app.get("/history", requireLogin, async (req, res) => {
  const { from, to } = req.query;
  const username = req.session.username;

  try {
    let summaries = [];

    if (from && to) {
      const fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);

      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);

      const result = await db.query(`
        SELECT period_start, period_end, weekly_limit, total_spent, remaining
        FROM weekly_summary
        WHERE username = $1 AND period_start BETWEEN $2 AND $3
        ORDER BY period_start DESC
      `, [username, fromDate, toDate]);

      summaries = result.rows.map(row => ({
        ...row,
        weekly_limit: parseFloat(row.weekly_limit),
        total_spent: parseFloat(row.total_spent),
        remaining: parseFloat(row.remaining),
        label: `${new Date(row.period_start).toLocaleDateString("it-IT")} – ${new Date(row.period_end).toLocaleDateString("it-IT")}`
      }));
    }

    res.render("index", {
      section: "history",
      summaries,
      from,
      to
    });
  } catch (err) {
    console.error("Erro ao carregar histórico:", err.message);
    res.status(500).send("Erro interno");
  }
});

// return for terminal
app.listen(port, () => {
  console.log(`Server running on port ${port}.`);
});