import express from "express";
import pg from "pg";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";

dotenv.config();
console.log("DATABASE_URL:", process.env.DATABASE_URL);

const { Pool } = pg;
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cookieParser());
app.set("view engine", "ejs");

const JWT_SECRET = process.env.JWT_SECRET || "jwt_secret_key";

// 🔐 Middleware for protection
function requireLogin(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect("/login");

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.redirect("/login");
  }
}

// 🚪 Logout
app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

// 📝 register
app.get("/register", (req, res) => {
  res.render("auth", { section: "register", error: null });
});

app.post("/register", async (req, res) => {
  const { username, email, password, confirmPassword } = req.body;

  if (!username || !email || !password || !confirmPassword) {
    return res.render("auth", { section: "register", error: "Compila tutti i campi." });
  }

  if (password !== confirmPassword) {
    return res.render("auth", { section: "register", error: "Le password non coincidono." });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, $3)",
      [username, email, hashedPassword]
    );

    res.redirect("/login");
  } catch (err) {
    res.render("auth", { section: "register", error: "Il nome utente o email esiste già." });
  }
});


// 🔐 Login
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
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
      expiresIn: "7d"
    });
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7
    });
    res.redirect("/");
  } else {
    res.render("auth", { section: "login", error: "password errata." });
  }
});

// home page
app.get("/", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;

    // actual week (monday to sunday)
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

    // last week
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(weekStart.getDate() - 7);
    prevWeekStart.setHours(0, 0, 0, 0);

    const prevWeekEnd = new Date(prevWeekStart);
    prevWeekEnd.setDate(prevWeekStart.getDate() + 6);
    prevWeekEnd.setHours(23, 59, 59, 999);

    // active salary in that week
    const salaryRes = await db.query(`
      SELECT value, date_created FROM family
      WHERE username = $1
      AND date_created <= $2
      AND (date_end IS NULL OR date_end >= $3)
      ORDER BY date_created DESC
    `, [username, weekEnd, weekStart]);

    const salaryValues = salaryRes.rows.map(s => parseFloat(s.value) || 0);
    const totalIncome = salaryValues.reduce((acc, val) => acc + val, 0);

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

    // Bills
    const billsRes = await db.query("SELECT value FROM bills WHERE username = $1", [username]);
    const billValues = billsRes.rows.map(b => parseFloat(b.value) || 0);
    const totalBills = billValues.reduce((acc, val) => acc + val, 0);

    const weeklyLimit = (totalIncome - totalBills) / totalWeeks;

    // expenses from actual week
    const expensesRes = await db.query(`
      SELECT id, name, value, date_expense FROM weekly_expenses
      WHERE username = $1 AND date_expense BETWEEN $2 AND $3
      ORDER BY id DESC
    `, [username, weekStart, weekEnd]);

    const expenses = expensesRes.rows.map(exp => ({
      ...exp,
      value: parseFloat(exp.value)
    }));

    const totalSpent = expenses.reduce((acc, exp) => acc + exp.value, 0);

    // Retifica settimanale
    const prevSummaryRes = await db.query(`
      SELECT weekly_limit, total_spent
      FROM weekly_summary
      WHERE username = $1 AND period_start = $2 AND period_end = $3
    `, [username, prevWeekStart, prevWeekEnd]);

    const prevSummary = prevSummaryRes.rows[0];
    const prevRemaining = prevSummary
      ? parseFloat(prevSummary.weekly_limit) - parseFloat(prevSummary.total_spent)
      : 0;

    const retificaValue = -1 * prevRemaining;
    const showRetifica = retificaValue !== 0;

    const visualSpent = totalSpent + (showRetifica ? retificaValue : 0);
    const visualRemaining = weeklyLimit - visualSpent;

    res.render("index", {
      section: "home",
      expenses,
      total: visualSpent,
      limit: weeklyLimit,
      remaining: visualRemaining,
      weekLabel,
      showRetifica,
      retificaValue
    });

  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send("internal error: " + err.message);
  }
});

// logic for update weekly summary
async function updateWeeklySummary(username, date) {
  const expenseDate = new Date(date);
  const dayOfWeek = expenseDate.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const weekStart = new Date(expenseDate);
  weekStart.setDate(expenseDate.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const salaryRes = await db.query(`
    SELECT value, date_created FROM family
    WHERE username = $1 AND date_created <= $2 AND (date_end IS NULL OR date_end >= $3)
    ORDER BY date_created DESC LIMIT 1
  `, [username, weekEnd, weekStart]);

  const salaryValues = salaryRes.rows.map(s => parseFloat(s.value));
  const totalIncome = salaryValues.reduce((acc, val) => acc + val, 0);

  let totalWeeks = 4;
  if (salaryRes.rows.length > 0) {
    const salaryStartDate = new Date(salaryRes.rows[0].date_created);
    const year = salaryStartDate.getFullYear();
    const month = salaryStartDate.getMonth();
    const salaryEndDate = new Date(year, month + 1, 13);
    const diffDays = Math.ceil((salaryEndDate - salaryStartDate) / (1000 * 60 * 60 * 24));
    totalWeeks = Math.ceil(diffDays / 7);
  }

  const billsRes = await db.query("SELECT value FROM bills WHERE username = $1", [username]);
  const billValues = billsRes.rows.map(b => parseFloat(b.value));
  const totalBills = billValues.reduce((acc, val) => acc + val, 0);

  const weeklyLimit = (totalIncome - totalBills) / totalWeeks;

  const expensesRes = await db.query(`
    SELECT SUM(value) FROM weekly_expenses
    WHERE username = $1 AND date_expense BETWEEN $2 AND $3
  `, [username, weekStart, weekEnd]);

  const totalSpent = parseFloat(expensesRes.rows[0].sum) || 0;

  const summaryExists = await db.query(`
    SELECT COUNT(*) FROM weekly_summary
    WHERE username = $1 AND period_start = $2 AND period_end = $3
  `, [username, weekStart, weekEnd]);

  if (parseInt(summaryExists.rows[0].count) === 0) {
    await db.query(`
      INSERT INTO weekly_summary (username, period_start, period_end, weekly_limit, total_spent)
      VALUES ($1, $2, $3, $4, $5)
    `, [username, weekStart, weekEnd, weeklyLimit, totalSpent]);
  } else {
    await db.query(`
      UPDATE weekly_summary
      SET weekly_limit = $1, total_spent = $2
      WHERE username = $3 AND period_start = $4 AND period_end = $5
    `, [weeklyLimit, totalSpent, username, weekStart, weekEnd]);
  }
}

// adding new weekly expense
// ADD weekly expense
app.post("/add-weekly_expenses", requireLogin, async (req, res) => {
  const { name, value, date_expense } = req.body;
  const username = req.user.username;

  try {
    const parsedValue = parseFloat(value);
    const expenseDate = new Date(date_expense);

    await db.query(
      "INSERT INTO weekly_expenses (name, value, date_expense, username) VALUES ($1, $2, $3, $4)",
      [name, parsedValue, expenseDate, username]
    );

    await updateWeeklySummary(username, expenseDate);
    res.redirect("/");
  } catch (err) {
    console.error("Error adding weekly expense:", err);
    res.status(500).send("Internal error: " + err.message);
  }
});

// EDIT weekly expense
app.post("/edit-weekly_expenses/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const { name, value, date_expense } = req.body;
  const username = req.user.username;

  try {
    const check = await db.query("SELECT username FROM weekly_expenses WHERE id = $1", [id]);
    if (check.rows[0]?.username !== username) return res.status(403).send("Accesso negato.");

    const parsedValue = parseFloat(value);
    const expenseDate = new Date(date_expense);

    await db.query(
      "UPDATE weekly_expenses SET name = $1, value = $2, date_expense = $3 WHERE id = $4",
      [name, parsedValue, expenseDate, id]
    );

    await updateWeeklySummary(username, expenseDate);
    res.redirect("/");
  } catch (err) {
    console.error("Error editing expense:", err.message);
    res.status(500).send("Internal server error");
  }
});

// DELETE weekly expense
app.post("/delete-weekly_expenses/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const username = req.user.username;

  try {
    const check = await db.query("SELECT username, date_expense FROM weekly_expenses WHERE id = $1", [id]);
    const expense = check.rows[0];
    if (!expense || expense.username !== username) return res.status(403).send("Accesso negato.");

    await db.query("DELETE FROM weekly_expenses WHERE id = $1", [id]);

    await updateWeeklySummary(username, expense.date_expense);
    res.redirect("/");
  } catch (err) {
    console.error("Error deleting expense:", err.message);
    res.status(500).send("Internal server error");
  }
});


// FAMILY page
app.get("/family", requireLogin, async (req, res) => {
  const username = req.user.username;
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
  const username = req.user.username;

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
  const username = req.user.username;

  const check = await db.query("SELECT username FROM family WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Accesso negato.");

  await db.query(
    "UPDATE family SET name = $1, value = $2, date_created = $3 WHERE id = $4",
    [name, value, date_created, id]
  );
  res.redirect("/family");
});

// DELETE family member
app.post("/delete-family/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const username = req.user.username;

  const check = await db.query("SELECT username FROM family WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Accesso negato.");

  await db.query("DELETE FROM family WHERE id = $1", [id]);
  res.redirect("/family");
});

// BILLS page
app.get("/bills", requireLogin, async (req, res) => {
  const username = req.user.username;
  const today = new Date();
  const todayDay = today.getDate();
  const salaryDay = 13;

  try {
    const result = await db.query(
      "SELECT id, name, value, day FROM bills WHERE username = $1 AND savings = false",
      [username]
    );

    let total = 0;
    let totalDaPagare = 0;
    const paidBills = [];
    const unpaidBills = [];

    result.rows.forEach(item => {
      const value = parseFloat(item.value) || 0;
      const billDay = parseInt(item.day);
    
      let isPaid = false;
    
      if (todayDay >= salaryDay) {
        isPaid = billDay >= salaryDay && billDay <= todayDay;
      } else {
        isPaid = (billDay >= salaryDay) || (billDay <= todayDay);
      }
    
      total += value;
      if (!isPaid) totalDaPagare += value;
    
      const bill = { ...item, value, isPaid };
      if (isPaid) paidBills.push(bill);
      else unpaidBills.push(bill);
    });
    

    paidBills.sort((a, b) => a.day - b.day);
    unpaidBills.sort((a, b) => a.day - b.day);
    const bills = [...paidBills, ...unpaidBills];

    res.render("index", {
      section: "bills",
      bills,
      total,
      totalDaPagare
    });
  } catch (err) {
    console.error("Error loading bills:", err.message);
    res.status(500).send("Internal error");
  }
});


// ADD bill
app.post("/add-bill", requireLogin, async (req, res) => {
  const { name, value, day } = req.body;
  const username = req.user.username;

  try {
    await db.query(
      "INSERT INTO bills (name, value, day, savings, username) VALUES ($1, $2, $3, false, $4)",
      [name, parseFloat(value), parseInt(day), username]
    );
    res.redirect("/bills");
  } catch (err) {
    console.error("Error adding bill:", err.message);
    res.status(500).send("Internal error");
  }
});

// EDIT bill
app.post("/edit-bill/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const { name, value, day } = req.body;
  const username = req.user.username;

  const check = await db.query("SELECT username FROM bills WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Accesso negato.");

  try {
    await db.query(
      "UPDATE bills SET name = $1, value = $2, day = $3, savings = false WHERE id = $4",
      [name, parseFloat(value), parseInt(day), id]
    );
    res.redirect("/bills");
  } catch (err) {
    console.error("Error editing bill:", err.message);
    res.status(500).send("Internal error");
  }
});


// DELETE bill
app.post("/delete-bill/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const username = req.user.username;

  const check = await db.query("SELECT username FROM bills WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Accesso negato.");

  try {
    await db.query("DELETE FROM bills WHERE id = $1", [id]);
    res.redirect("/bills");
  } catch (err) {
    console.error("Error deleting bill:", err.message);
    res.status(500).send("Internal server error");
  }
});

// savings
app.get("/savings", requireLogin, async (req, res) => {
  const username = req.user.username;

  try {
    const result = await db.query(
      "SELECT id, name, value, day FROM bills WHERE username = $1 AND savings = true ORDER BY day ASC",
      [username]
    );

    const bills = result.rows.map(item => ({
      ...item,
      value: parseFloat(item.value) || 0,
      isPaid: true
    }));

    const total = bills.reduce((acc, item) => acc + item.value, 0);

    res.render("index", {
      section: "savings",
      bills,
      total,
      totalDaPagare: 0
    });
  } catch (err) {
    console.error("Error loading savings:", err.message);
    res.status(500).send("Internal error");
  }
});

// ADD savings
app.post("/add-savings", requireLogin, async (req, res) => {
  const { name, value, day } = req.body;
  const username = req.user.username;

  try {
    await db.query(
      "INSERT INTO bills (name, value, day, savings, username) VALUES ($1, $2, $3, true, $4)",
      [name, parseFloat(value), parseInt(day), username]
    );
    res.redirect("/savings");
  } catch (err) {
    console.error("Error adding savings:", err.message);
    res.status(500).send("Internal error");
  }
});


// EDIT savings
app.post("/edit-savings/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const { name, value, day } = req.body;
  const username = req.user.username;

  const check = await db.query("SELECT username FROM bills WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Accesso negato.");

  try {
    await db.query(
      "UPDATE bills SET name = $1, value = $2, day = $3, savings = true WHERE id = $4",
      [name, parseFloat(value), parseInt(day), id]
    );
    res.redirect("/savings");
  } catch (err) {
    console.error("Error editing savings:", err.message);
    res.status(500).send("Internal error");
  }
});

// DELETE savings
app.post("/delete-savings/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const username = req.user.username;

  try {
    const check = await db.query("SELECT username, savings FROM bills WHERE id = $1", [id]);
    const item = check.rows[0];

    if (!item || item.username !== username || item.savings !== true) {
      return res.status(403).send("Accesso negato.");
    }

    await db.query("DELETE FROM bills WHERE id = $1", [id]);
    res.redirect("/savings");
  } catch (err) {
    console.error("Error deleting savings:", err.message);
    res.status(500).send("Internal server error");
  }
});


// history
app.get("/history", requireLogin, async (req, res) => {
  const username = req.user.username;

  try {
    const result = await db.query(`
      SELECT period_start, period_end, weekly_limit, total_spent
      FROM weekly_summary
      WHERE username = $1
      ORDER BY period_start DESC
    `, [username]);

    const summaries = result.rows.map(row => {
      const weekly_limit = parseFloat(row.weekly_limit);
      const total_spent = parseFloat(row.total_spent);
      const remaining = weekly_limit - total_spent;

      return {
        ...row,
        weekly_limit,
        total_spent,
        remaining,
        label: `${new Date(row.period_start).toLocaleDateString("it-IT")} – ${new Date(row.period_end).toLocaleDateString("it-IT")}`
      };
    });

    res.render("index", {
      section: "history",
      summaries
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send("internal error: " + err.message);
  }
});


// return for terminal
app.listen(port, () => {
  console.log(`Server running on port ${port}.`);
});