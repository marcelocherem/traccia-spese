import express from "express";
import pg from "pg";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";

dotenv.config();

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
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "jwt_secret_key";

// AUTH MIDDLEWARE
function requireLogin(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect("/login");

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.redirect("/login");
  }
}

// LOGOUT
app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

// REGISTER
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
  } catch {
    res.render("auth", { section: "register", error: "Il nome utente o email esiste già." });
  }
});

// LOGIN
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

  if (!match) {
    return res.render("auth", { section: "login", error: "password errata." });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: "7d"
  });

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  });

  res.redirect("/");
});

// GLOBAL ALERT MIDDLEWARE
app.use(requireLogin, async (req, res, next) => {
  try {
    const username = req.user.username;
    const paydayRes = await db.query(
      "SELECT payday FROM users WHERE username = $1",
      [username]
    );
    const payday = paydayRes.rows[0]?.payday || null;

    const today = new Date();
    const todayDay = today.getDate();
    const billsRes = await db.query(
      "SELECT id, name, value, day, pago, tipo FROM bills WHERE username = $1",
      [username]
    );
    let bills = billsRes.rows;

    const alerts = {
      paydayMissing: !payday,
      billsDue: [],
      billsOverdue: []
    };
    if (!payday) {
      res.locals.payday = null;
      res.locals.alerts = alerts;
      res.locals.alertCount = 1;
      return next();
    }

    const autoBillsToday = bills.filter(b =>
      b.tipo?.toLowerCase() === "automatic" &&
      !b.pago &&
      b.day === todayDay
    );

    for (const b of autoBillsToday) {
      await db.query(
        "UPDATE bills SET pago = true WHERE id = $1",
        [b.id]
      );
    }
    const billsRes2 = await db.query(
      "SELECT id, name, value, day, pago, tipo FROM bills WHERE username = $1",
      [username]
    );
    bills = billsRes2.rows;
    let candidateBills = [];

    if (todayDay >= payday) {
      candidateBills = bills.filter(b =>
        b.tipo?.toLowerCase() === "manual" &&
        !b.pago &&
        b.day >= payday &&
        b.day <= todayDay
      );
    } else {
      candidateBills = bills.filter(b =>
        b.tipo?.toLowerCase() === "manual" &&
        !b.pago &&
        (b.day >= payday || b.day <= todayDay)
      );
    }

    candidateBills.sort((a, b) => a.day - b.day);
    for (const b of candidateBills) {
      if (b.day === todayDay) alerts.billsDue.push(b);
      else alerts.billsOverdue.push(b);
    }
    const alertCount =
      (alerts.paydayMissing ? 1 : 0) +
      alerts.billsDue.length +
      alerts.billsOverdue.length;

    res.locals.payday = payday;
    res.locals.alerts = alerts;
    res.locals.alertCount = alertCount;

    next();
  } catch (err) {
    console.error("Error in alert middleware:", err);
    next();
  }
});

// FINALIZE PAST WEEKS
async function finalizePastWeeks(username) {
  await db.query(`
    UPDATE weekly_summary
    SET is_final = true
    WHERE username = $1
      AND period_end < CURRENT_DATE
      AND is_final = false
  `, [username]);
}

async function getActiveCycle(username, referenceDate) {
  const res = await db.query(`
    SELECT id, start_date, end_date, weeks_count
    FROM cycles
    WHERE username = $1
      AND start_date::date <= $2::date
      AND end_date::date >= $2::date
    LIMIT 1
  `, [username, referenceDate]);

  return res.rows[0] || null;
}

async function createCycleFromPayday(username, referenceDate) {
  const userRes = await db.query(`
    SELECT payday FROM users WHERE username = $1
  `, [username]);

  const payday = userRes.rows[0]?.payday;
  if (!payday) return null;

  const today = new Date(referenceDate + "T00:00:00");

  let nextPayday = new Date(today.getFullYear(), today.getMonth(), payday);

  if (nextPayday <= today) {
    nextPayday = new Date(today.getFullYear(), today.getMonth() + 1, payday);
  }

  const startISO = referenceDate;

  const end = new Date(nextPayday);
  end.setDate(end.getDate() - 1);

  const endISO = end.toISOString().slice(0, 10);

  const weeksCount = getItalianWeeks(today, end);

  const insert = await db.query(`
    INSERT INTO cycles (username, start_date, end_date, weeks_count)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [username, startISO, endISO, weeksCount]);

  return insert.rows[0].id;
}

async function updateWeeklySummary(username, date) {
  const expenseDate = new Date(date);
  const { weekStart, weekEnd } = getWeekRange(expenseDate);

  const cycle = await getActiveCycle(username, expenseDate.toISOString().split("T")[0]);
  if (!cycle) return;

  const summaryRes = await db.query(`
    SELECT id, weekly_limit, total_spent, is_final
    FROM weekly_summary
    WHERE username = $1 AND period_start = $2 AND period_end = $3
  `, [username, weekStart, weekEnd]);

  const summary = summaryRes.rows[0];

  const expensesRes = await db.query(`
    SELECT SUM(value) AS total
    FROM weekly_expenses
    WHERE username = $1
      AND date_expense BETWEEN $2 AND $3
  `, [username, weekStart, weekEnd]);

  const totalSpent = parseFloat(expensesRes.rows[0].total) || 0;

  if (summary?.is_final) {
    await db.query(`
      UPDATE weekly_summary
      SET total_spent = $1
      WHERE id = $2
    `, [totalSpent, summary.id]);

    return;
  }

  let weeklyLimit = summary?.weekly_limit;

  if (!summary) {
    const incomesRes = await db.query(`
      SELECT value FROM incomes
      WHERE username = $1 AND cycle_id = $2
    `, [username, cycle.id]);

    const totalIncome = incomesRes.rows.reduce((acc, r) => acc + parseFloat(r.value || 0), 0);

    const billsRes = await db.query(`
      SELECT value FROM bills
      WHERE username = $1
    `, [username]);

    const totalBills = billsRes.rows.reduce((acc, r) => acc + parseFloat(r.value || 0), 0);

    const savingsRes = await db.query(`
      SELECT amount FROM savings
      WHERE username = $1 AND cycle_id = $2
    `, [username, cycle.id]);

    const totalSavings = savingsRes.rows.reduce((acc, r) => acc + parseFloat(r.amount || 0), 0);

    const startDate = new Date(cycle.start_date);
    const endDate = new Date(cycle.end_date);

    const startMonday = new Date(startDate);
    startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));

    const endMonday = new Date(endDate);
    endMonday.setDate(endDate.getDate() - (endDate.getDay() === 0 ? 6 : endDate.getDay() - 1));

    const totalWeeks = Math.floor((endMonday - startMonday) / (7 * 24 * 60 * 60 * 1000)) + 1;

    weeklyLimit = (totalIncome - totalBills - totalSavings) / totalWeeks;

    await db.query(`
      INSERT INTO weekly_summary (username, period_start, period_end, weekly_limit, total_spent, is_final)
      VALUES ($1, $2, $3, $4, $5, false)
    `, [username, weekStart, weekEnd, weeklyLimit, totalSpent]);

    return;
  }

  await db.query(`
    UPDATE weekly_summary
    SET total_spent = $1
    WHERE id = $2
  `, [totalSpent, summary.id]);
}

function getWeekRange(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

function getItalianWeeks(startDate, endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const startMonday = new Date(start);
  startMonday.setDate(start.getDate() - (start.getDay() === 0 ? 6 : start.getDay() - 1));

  const endMonday = new Date(end);
  endMonday.setDate(end.getDate() - (end.getDay() === 0 ? 6 : end.getDay() - 1));

  const diff = endMonday - startMonday;
  const weeks = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;

  return weeks;
}

// HOME
app.get("/", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;

    const userRes = await db.query(`
      SELECT payday FROM users WHERE username = $1
    `, [username]);

    const payday = userRes.rows[0]?.payday || null;

    if (!payday) {
      return res.redirect("/new-user");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toLocaleDateString("en-CA");

    const cycle = await getActiveCycle(username, todayISO);

    if (!cycle) {
      return res.redirect("/new-cycle");
    }

    const incomesRes = await db.query(`
      SELECT value FROM incomes
      WHERE username = $1 AND cycle_id = $2
    `, [username, cycle.id]);

    const totalIncome = incomesRes.rows
      .reduce((acc, r) => acc + parseFloat(r.value || 0), 0);

    const billsRes = await db.query(`
      SELECT value FROM bills
      WHERE username = $1
    `, [username]);

    const totalBills = billsRes.rows
      .reduce((acc, r) => acc + parseFloat(r.value || 0), 0);

    const savingsRes = await db.query(`
      SELECT amount FROM savings
      WHERE username = $1 AND cycle_id = $2
    `, [username, cycle.id]);

    const totalSavings = savingsRes.rows
      .reduce((acc, r) => acc + parseFloat(r.amount || 0), 0);

    const startDate = new Date(cycle.start_date);
    const endDate = new Date(cycle.end_date);

    const startMonday = new Date(startDate);
    startMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));

    const endMonday = new Date(endDate);
    endMonday.setDate(endDate.getDate() - (endDate.getDay() === 0 ? 6 : endDate.getDay() - 1));

    const totalWeeks = Math.floor((endMonday - startMonday) / (7 * 24 * 60 * 60 * 1000)) + 1;

    const weeklyLimit = (totalIncome - totalBills - totalSavings) / totalWeeks;

    const dayOfWeek = today.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const expensesRes = await db.query(`
      SELECT id, name, value, date_expense
      FROM weekly_expenses
      WHERE username = $1
        AND date_expense BETWEEN $2 AND $3
    `, [username, weekStart, weekEnd]);

    const expenses = expensesRes.rows.map(e => ({
      ...e,
      value: parseFloat(e.value)
    }));

    const totalSpent = expenses.reduce((acc, e) => acc + e.value, 0);

    const summaryRes = await db.query(`
      SELECT weekly_limit, total_spent, period_start
      FROM weekly_summary
      WHERE username = $1
        AND period_start < $2
        AND period_start >= $3
    `, [username, weekStart, cycle.start_date]);

    let rettifica = 0;

    summaryRes.rows.forEach(row => {
      const limit = parseFloat(row.weekly_limit);
      const spent = parseFloat(row.total_spent);
      rettifica += (limit - spent);
    });

    const visualSpent = totalSpent - rettifica;
    const visualRemaining = weeklyLimit - visualSpent;

    const weekLabel = `${weekStart.toLocaleDateString("it-IT", { day: '2-digit', month: 'short' })} - ${weekEnd.toLocaleDateString("it-IT", { day: '2-digit', month: 'short' })}`;

    res.render("index", {
      section: "home",
      expenses,
      total: visualSpent,
      limit: weeklyLimit,
      remaining: visualRemaining,
      weekLabel,
      showRetifica: rettifica !== 0,
      retificaValue: rettifica,
      cycle,
      payday
    });

  } catch (err) {
    console.error("HOME ERROR:", err);
    res.status(500).send("Internal error");
  }
});

// ADD WEEKLY EXPENSE
app.post("/add-weekly_expenses", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { name, value, date_expense } = req.body;

    const today = new Date();
    const todayISO = today.toLocaleDateString("en-CA");

    const cycle = await getActiveCycle(username, todayISO);

    if (!cycle) return res.redirect("/new-cycle");

    await db.query(`
      INSERT INTO weekly_expenses (name, value, date_expense, username, cycle_id)
      VALUES ($1, $2, $3, $4, $5)
    `, [name, parseFloat(value), date_expense, username, cycle.id]);

    await updateWeeklySummary(username, date_expense);

    res.redirect("/");

  } catch (err) {
    console.error("Error adding weekly expense:", err);
    res.status(500).send("Internal error");
  }
});

// EDIT WEEKLY EXPENSE
app.post("/edit-weekly_expenses/:id", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;
    const { name, value, date_expense } = req.body;

    const check = await db.query(`
      SELECT username FROM weekly_expenses WHERE id = $1
    `, [id]);

    if (!check.rows[0] || check.rows[0].username !== username) {
      return res.status(403).send("Accesso negato.");
    }

    await db.query(`
      UPDATE weekly_expenses
      SET name = $1, value = $2, date_expense = $3
      WHERE id = $4
    `, [name, parseFloat(value), date_expense, id]);

    await updateWeeklySummary(username, date_expense);

    res.redirect("/");

  } catch (err) {
    console.error("Error editing expense:", err);
    res.status(500).send("Internal error");
  }
});

// DELETE WEEKLY EXPENSE
app.post("/delete-weekly_expenses/:id", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;

    const check = await db.query(`
      SELECT username, date_expense FROM weekly_expenses WHERE id = $1
    `, [id]);

    if (!check.rows[0] || check.rows[0].username !== username) {
      return res.status(403).send("Accesso negato.");
    }

    const date = check.rows[0].date_expense;

    await db.query(`
      DELETE FROM weekly_expenses WHERE id = $1
    `, [id]);

    await updateWeeklySummary(username, date);

    res.redirect("/");

  } catch (err) {
    console.error("Error deleting expense:", err);
    res.status(500).send("Internal error");
  }
});

// SET PAYDAY
app.post("/set-payday", requireLogin, async (req, res) => {
  const { payday } = req.body;
  const username = req.user.username;

  try {
    await db.query(
      "UPDATE users SET payday = $1 WHERE username = $2",
      [payday, username]
    );
    res.redirect("/");
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send("Internal error");
  }
});

// INCOMES PAGE
app.get("/incomes", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toLocaleDateString("en-CA"); // yyyy-mm-dd
    const cycle = await getActiveCycle(username, todayISO);

    if (!cycle) {
      return res.redirect("/new-cycle");
    }

    const incomesRes = await db.query(`
      SELECT id, name, value, type, status, date_created, cycle_id
      FROM incomes
      WHERE username = $1
        AND (cycle_id IS NULL OR cycle_id = $2)
      ORDER BY date_created DESC
    `, [username, cycle.id]);

    const incomes = incomesRes.rows.map(row => ({
      ...row,
      value: parseFloat(row.value),
      date_created_raw: new Date(row.date_created).toISOString().split("T")[0]
    }));

    const total = incomes.reduce((sum, inc) => sum + inc.value, 0);

    const cycles = [{
      id: cycle.id,
      total,
      incomes
    }];

    res.render("index", {
      section: "incomes",
      cycles,
      incomes,
      total
    });

  } catch (err) {
    console.error("INCOMES GET ERROR:", err);
    res.status(500).send("Internal error");
  }
});

// ADD INCOME
app.post("/add-incomes", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { name, value, date_created, type } = req.body;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toLocaleDateString("en-CA"); // yyyy-mm-dd
    const cycle = await getActiveCycle(username, todayISO);

    if (!cycle) {
      return res.redirect("/new-cycle");
    }

    await db.query(`
      INSERT INTO incomes (username, cycle_id, name, value, type, status, date_created)
      VALUES ($1, $2, $3, $4, $5, 'confirmed', $6)
    `, [
      username,
      cycle.id,
      name,
      parseFloat(value) || 0,
      type || "income",
      date_created
    ]);

    res.redirect("/incomes");

  } catch (err) {
    console.error("ADD INCOME ERROR:", err);
    res.status(500).send("Internal error");
  }
});

// EDIT INCOME
app.post("/edit-incomes/:id", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;
    const { name, value, date_created, type } = req.body;

    const check = await db.query(`
      SELECT username FROM incomes WHERE id = $1
    `, [id]);

    if (!check.rows[0] || check.rows[0].username !== username) {
      return res.status(403).send("Accesso negato.");
    }

    await db.query(`
      UPDATE incomes
      SET name = $1, value = $2, date_created = $3, type = $4
      WHERE id = $5
    `, [
      name,
      parseFloat(value) || 0,
      date_created,
      type || "income",
      id
    ]);

    res.redirect("/incomes");

  } catch (err) {
    console.error("EDIT INCOME ERROR:", err);
    res.status(500).send("Internal error");
  }
});

// DELETE INCOME
app.post("/delete-incomes/:id", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;

    const check = await db.query(`
      SELECT username FROM incomes WHERE id = $1
    `, [id]);

    if (!check.rows[0] || check.rows[0].username !== username) {
      return res.status(403).send("Accesso negato.");
    }

    await db.query("DELETE FROM incomes WHERE id = $1", [id]);

    res.redirect("/incomes");

  } catch (err) {
    console.error("DELETE INCOME ERROR:", err);
    res.status(500).send("Internal error");
  }
});

function isAutomaticBillPaid(billDay, todayDay, salaryDay) {
  if (todayDay >= salaryDay) {
    return billDay >= salaryDay && billDay <= todayDay;
  } else {
    return (billDay >= salaryDay) || (billDay <= todayDay);
  }
}

// BILLS PAGE
app.get("/bills", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;

    const userRes = await db.query(`
      SELECT payday FROM users WHERE username = $1
    `, [username]);

    const salaryDay = userRes.rows[0]?.payday;
    if (!salaryDay) return res.redirect("/new-user");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toLocaleDateString("en-CA");
    const todayDay = today.getDate();

    const cycle = await getActiveCycle(username, todayISO);

    if (!cycle) return res.redirect("/new-cycle");

    const result = await db.query(`
      SELECT id, name, value, day, tipo, pago, cycle_id
      FROM bills
      WHERE username = $1
        AND savings = false
        AND (cycle_id IS NULL OR cycle_id = $2)
      ORDER BY day ASC
    `, [username, cycle.id]);

    let total = 0;
    let totalDaPagare = 0;

    const paidBills = [];
    const unpaidBills = [];

    result.rows.forEach(item => {
      const value = parseFloat(item.value) || 0;
      const billDay = parseInt(item.day);

      let isPaid = false;

      if (item.tipo === "manual") {
        isPaid = item.pago === true;
      } else {
        isPaid = isAutomaticBillPaid(billDay, todayDay, salaryDay);
      }

      total += value;
      if (!isPaid) totalDaPagare += value;

      const bill = { ...item, value, isPaid };

      if (isPaid) paidBills.push(bill);
      else unpaidBills.push(bill);
    });

    const totalPagato = total - totalDaPagare;

    paidBills.sort((a, b) => a.day - b.day);
    unpaidBills.sort((a, b) => a.day - b.day);

    const bills = [...paidBills, ...unpaidBills];

    const cycles = [{
      id: cycle.id,
      total,
      bills,
      totalDaPagare,
      totalPagato
    }];

    res.render("index", {
      section: "bills",
      cycles,
      total,
      totalDaPagare,
      totalPagato,
      bills
    });

  } catch (err) {
    console.error("Error loading bills:", err);
    res.status(500).send("Internal error");
  }
});

// paid bills
app.post("/bills/:id/mark-paid", requireLogin, async (req, res) => {
  try {
    const id = req.params.id;

    await db.query(`
      UPDATE bills SET pago = true WHERE id = $1
    `, [id]);

    res.status(200).json({ success: true });

  } catch (err) {
    console.error("Erro ao marcar como paga:", err);
    res.status(500).json({ error: "Erro no servidor" });
  }
});

// ADD BILL
app.post("/add-bill", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { name, value, day, tipo } = req.body;

    await db.query(`
      INSERT INTO bills (username, name, value, day, tipo, savings)
      VALUES ($1, $2, $3, $4, $5, false)
    `, [
      username,
      name,
      parseFloat(value) || 0,
      parseInt(day) || 0,
      tipo
    ]);

    res.redirect("/bills");

  } catch (err) {
    console.error("Error adding bill:", err.message);
    res.status(500).send("Internal error");
  }
});

// EDIT BILL
app.post("/edit-bill/:id", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;
    const { name, value, day, tipo } = req.body;

    const check = await db.query(`
      SELECT username FROM bills WHERE id = $1
    `, [id]);

    if (!check.rows[0] || check.rows[0].username !== username) {
      return res.status(403).send("Accesso negato.");
    }

    await db.query(`
      UPDATE bills
      SET name = $1, value = $2, day = $3, tipo = $4
      WHERE id = $5
    `, [
      name,
      parseFloat(value) || 0,
      parseInt(day) || 0,
      tipo,
      id
    ]);

    res.redirect("/bills");

  } catch (err) {
    console.error("Error editing bill:", err.message);
    res.status(500).send("Internal error");
  }
});

//a

// DELETE BILL
app.post("/delete-bill/:id", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;

    const check = await db.query(`
      SELECT username FROM bills WHERE id = $1
    `, [id]);

    if (!check.rows[0] || check.rows[0].username !== username) {
      return res.status(403).send("Accesso negato.");
    }

    await db.query(`
      DELETE FROM bills WHERE id = $1
    `, [id]);

    res.redirect("/bills");

  } catch (err) {
    console.error("Error deleting bill:", err.message);
    res.status(500).send("Internal error");
  }
});

// SAVINGS PAGE
app.get("/savings", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;

    const result = await db.query(`
      SELECT id, name, value, day
      FROM bills
      WHERE username = $1 AND savings = true
      ORDER BY day ASC
    `, [username]);

    const bills = result.rows.map(b => ({
      ...b,
      value: parseFloat(b.value)
    }));

    const total = bills.reduce((acc, b) => acc + b.value, 0);

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

// ADD SAVINGS
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

// EDIT SAVINGS
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

// DELETE SAVINGS
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

// SETTINGS PAGE
app.get("/settings", requireLogin, async (req, res) => {
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
      section: "settings",
      summaries
    });
  } catch (err) {
    console.error("Error loading settings:", err.message);
    res.status(500).send("Internal error");
  }
});

// NEW CYCLE — GET PAGE
app.get("/new-cycle", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toLocaleDateString("en-CA"); // yyyy-mm-dd
    let page = parseInt(req.query.page || "0", 10);

    // Se já existe ciclo ativo → volta pra home
    const active = await getActiveCycle(username, todayISO);
    if (active) return res.redirect("/");

    // Se leftover já foi usado → nunca voltar para page 0
    const leftoverIncomeRes = await db.query(`
      SELECT id FROM incomes
      WHERE username = $1 AND cycle_id IS NULL AND type = 'leftover'
    `, [username]);

    if (leftoverIncomeRes.rows.length > 0 && page === 0) {
      return res.redirect("/new-cycle?page=1");
    }

    // Último ciclo existente (ciclo anterior)
    const lastCycleRes = await db.query(`
      SELECT id FROM cycles
      WHERE username = $1
      ORDER BY id DESC
      LIMIT 1
    `, [username]);

    const cycle = lastCycleRes.rows[0] || null;

    let leftover = 0;

    if (cycle) {
      const cycleId = cycle.id;

      const incomesRes = await db.query(`
        SELECT value FROM incomes
        WHERE username = $1 AND cycle_id = $2
      `, [username, cycleId]);

      const totalIncome = incomesRes.rows.reduce((acc, r) => acc + parseFloat(r.value || 0), 0);

      const billsResOld = await db.query(`
        SELECT value FROM bills
        WHERE username = $1 AND (cycle_id = $2 OR cycle_id IS NULL)
      `, [username, cycleId]);

      const totalBillsOld = billsResOld.rows.reduce((acc, r) => acc + parseFloat(r.value || 0), 0);

      const savingsRes = await db.query(`
        SELECT amount FROM savings
        WHERE username = $1 AND cycle_id = $2
      `, [username, cycleId]);

      const totalSavings = savingsRes.rows.reduce((acc, r) => acc + parseFloat(r.amount || 0), 0);

      const expensesRes = await db.query(`
        SELECT value FROM weekly_expenses
        WHERE username = $1 AND cycle_id = $2
      `, [username, cycleId]);

      const totalSpent = expensesRes.rows.reduce((acc, r) => acc + parseFloat(r.value || 0), 0);

      leftover = totalIncome - totalBillsOld - totalSavings - totalSpent;
    }

    // Bills globais (modelo)
    const billsRes = await db.query(`
      SELECT id, name, value, day, tipo
      FROM bills
      WHERE username = $1
      ORDER BY day ASC
    `, [username]);

    const bills = billsRes.rows;

    // Incomes sem cycle_id (novo ciclo)
    let incomes = [];
    if (page >= 1) {
      const incomesRes = await db.query(`
        SELECT id, name, value, type, status
        FROM incomes
        WHERE username = $1 AND cycle_id IS NULL
        ORDER BY id ASC
      `, [username]);

      incomes = incomesRes.rows;
    }

    // WEEKLY LIMIT — sempre calculado
    let weeklyValue = 0;

    const userRes = await db.query(`
      SELECT payday FROM users WHERE username = $1
    `, [username]);

    const payday = userRes.rows[0]?.payday || null;

    if (payday) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let nextPayday = new Date(today.getFullYear(), today.getMonth(), payday);
      if (nextPayday <= today) {
        nextPayday = new Date(today.getFullYear(), today.getMonth() + 1, payday);
      }

      const end = new Date(nextPayday);
      end.setDate(end.getDate() - 1);

      const incomesNewRes = await db.query(`
        SELECT value FROM incomes
        WHERE username = $1 AND cycle_id IS NULL
      `, [username]);

      const totalIncomesNew = incomesNewRes.rows.reduce((acc, r) => acc + parseFloat(r.value || 0), 0);

      const billsNewRes = await db.query(`
        SELECT value FROM bills
        WHERE username = $1 AND cycle_id IS NULL
      `, [username]);

      const totalBillsNew = billsNewRes.rows.reduce((acc, r) => acc + parseFloat(r.value || 0), 0);

      const leftoverNovo = totalIncomesNew - totalBillsNew;

      const weeks = getItalianWeeks(today, end);

      weeklyValue = weeks > 0 ? leftoverNovo / weeks : 0;
    }

    // Se já passou da página 0, leftover antigo não deve mais aparecer
    let weekLeftover = leftover;
    if (page > 0) weekLeftover = 0;

    const error = req.query.error || null;

    res.render("new-cycle", {
      section: "new-cycle",
      page,
      cycle,
      leftover,
      incomes,
      bills,
      weeklyValue,
      weekLeftover,
      error
    });

  } catch (err) {
    console.error("Error loading new cycle:", err);
    res.redirect("/");
  }
});

// LEFTOVER ACTION
app.post("/new-cycle/leftover-action", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { action, amount } = req.body;

    const val = parseFloat(amount) || 0;

    const lastCycleRes = await db.query(`
      SELECT id FROM cycles
      WHERE username = $1
      ORDER BY id DESC
      LIMIT 1
    `, [username]);

    const lastCycle = lastCycleRes.rows[0];

    if (!lastCycle) {
      console.error("Nenhum ciclo anterior encontrado.");
      return res.redirect("/new-cycle?page=0");
    }

    const cycleId = lastCycle.id;

    if (action === "use") {
      await db.query(`
        INSERT INTO incomes (username, name, cycle_id, value, date_created, type, status)
        VALUES ($1, 'Leftover', NULL, $2, now(), 'leftover', 'confirmed')
      `, [username, val]);
    }

    else if (action === "savings") {
      await db.query(`
        INSERT INTO savings (username, cycle_id, amount, source, created_at)
        VALUES ($1, $2, $3, 'leftover', now())
      `, [username, cycleId, val]);
    }

    return res.redirect("/new-cycle?page=1");

  } catch (err) {
    console.error("leftover-action error:", err);
    return res.redirect("/new-cycle?page=0");
  }
});

// ADD SALARY
app.post("/new-cycle/add-salary", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { name, value } = req.body;

    const val = parseFloat(value) || 0;

    await db.query(`
      INSERT INTO incomes (username, cycle_id, name, value, type, status, date_created)
      VALUES ($1, NULL, $2, $3, 'salary', 'confirmed', now())
    `, [username, name, val]);

    res.redirect("/new-cycle?page=1");

  } catch (err) {
    console.error("new-cycle add-salary error:", err);
    res.redirect("/new-cycle?page=1");
  }
});


// ADD BILL
app.post("/new-cycle/add-bill", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { name, value, day, tipo } = req.body;

    await db.query(`
      INSERT INTO bills (username, name, value, day, savings, tipo)
      VALUES ($1, $2, $3, $4, false, $5)
    `, [username, name, parseFloat(value) || 0, parseInt(day) || 0, tipo]);

    res.redirect("/new-cycle?page=2");

  } catch (err) {
    console.error("new-cycle add-bill error:", err);
    res.redirect("/new-cycle?page=2");
  }
});

// DELETEE BILLS
app.post("/new-cycle/delete-bills", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const ids = req.body.ids.split(",").map(id => parseInt(id));

    await db.query(`
      DELETE FROM bills
      WHERE username = $1 AND id = ANY($2)
    `, [username, ids]);

    // Volta para a página 2 do wizard
    res.redirect("/new-cycle?page=2");

  } catch (err) {
    console.error("delete-bills error:", err);
    res.redirect("/new-cycle?page=2");
  }
});

// CONFIRM CYCLE
app.post("/new-cycle/confirm", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { weeklyOriginal, weeklyNew } = req.body;

    // Data de hoje (local, sem timezone)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toLocaleDateString("en-CA"); // yyyy-mm-dd

    const orig = parseFloat(weeklyOriginal) || 0;
    const novo = parseFloat(weeklyNew) || 0;

    // Bloquear aumento — igual new-user
    if (novo > orig) {
      return res.redirect(`/new-cycle?page=2&error=weeklyLimit`);
    }

    // Criar novo ciclo — igual new-user
    const cycleId = await createCycleFromPayday(username, todayISO);

    // Buscar número de semanas do ciclo recém-criado
    const weeksRes = await db.query(`
      SELECT weeks_count
      FROM cycles
      WHERE id = $1
    `, [cycleId]);

    const weeks = weeksRes.rows[0].weeks_count;

    // Diferença semanal
    const weeklyDiff = orig - novo;

    // Diferença total — igual new-user
    const totalDiff = weeklyDiff * weeks;

    // Se houver diferença, mandar para savings — igual new-user
    if (totalDiff > 0) {
      await db.query(`
        INSERT INTO savings (username, cycle_id, amount, source, created_at)
        VALUES ($1, $2, $3, 'weekly-diff', now())
      `, [username, cycleId, totalDiff]);
    }

    // Amarrar incomes ao ciclo — igual new-user
    await db.query(`
      UPDATE incomes
      SET cycle_id = $1
      WHERE username = $2 AND cycle_id IS NULL
    `, [cycleId, username]);

    // Bills NÃO têm cycle_id — não mexe

    // Finalizar
    res.redirect("/");

  } catch (err) {
    console.error("confirm cycle error:", err);
    res.redirect("/new-cycle?page=3");
  }
});


// b

// NEW USER — GET PAGE
app.get("/new-user", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;

    const userRes = await db.query(`
      SELECT payday FROM users WHERE username = $1
    `, [username]);

    const payday = userRes.rows[0]?.payday || null;

    const incomesRes = await db.query(`
      SELECT id, name, value, type, status
      FROM incomes
      WHERE username = $1 AND cycle_id IS NULL
    `, [username]);

    const incomes = incomesRes.rows;

    const billsRes = await db.query(`
      SELECT id, name, value, day, tipo
      FROM bills
      WHERE username = $1
    `, [username]);

    const bills = billsRes.rows;

    let leftover = 0;
    let weeklyValue = 0;

    if (payday) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let nextPayday = new Date(today.getFullYear(), today.getMonth(), payday);

      if (nextPayday <= today) {
        nextPayday = new Date(today.getFullYear(), today.getMonth() + 1, payday);
      }

      const end = new Date(nextPayday);
      end.setDate(end.getDate() - 1);

      const totalIncomes = incomes.reduce((acc, s) => acc + parseFloat(s.value || 0), 0);
      const totalBills = bills.reduce((acc, b) => acc + parseFloat(b.value || 0), 0);

      leftover = totalIncomes - totalBills;

      const weeks = getItalianWeeks(today, end);

      weeklyValue = leftover / weeks;
    }

    res.render("new-user", {
      section: "new-user",
      leftover,
      weeklyValue,
      incomes,
      bills,
      user: { payday }
    });

  } catch (err) {
    console.error("Error loading new user page:", err);
    res.redirect("/");
  }
});

app.post("/new-user/add-salary", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { name, value } = req.body;

    const val = parseFloat(value) || 0;

    await db.query(`
      INSERT INTO incomes (username, cycle_id, name, value, type, status, date_created)
      VALUES ($1, NULL, $2, $3, 'salary', 'confirmed', now())
    `, [username, name, val]);

    res.redirect("/new-user?page=1");
  } catch (err) {
    console.error("new-user add-salary error:", err);
    res.redirect("/new-user?page=1");
  }
});

// SET PAYDAY
// NEW USER — SAVE PAYDAY
app.post("/new-user/set-payday", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { paydayDay } = req.body;

    const payday = parseInt(paydayDay, 10);

    if (!payday || payday < 1 || payday > 31) {
      return res.redirect("/new-user?page=0");
    }

    await db.query(`
      UPDATE users
      SET payday = $1
      WHERE username = $2
    `, [payday, username]);

    return res.redirect("/new-user?page=1");

  } catch (err) {
    console.error("set-payday error:", err);
    res.redirect("/new-user?page=0");
  }
});

// ADD BILL (new-user)
app.post("/new-user/add-bill", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { name, value, day, tipo } = req.body;

    await db.query(`
      INSERT INTO bills (username, name, value, day, tipo, savings)
      VALUES ($1, $2, $3, $4, $5, false)
    `, [username, name, parseFloat(value) || 0, parseInt(day) || 0, tipo]);

    res.redirect("/new-user?page=2");
  } catch (err) {
    console.error("new-user add-bill error:", err);
    res.redirect("/new-user?page=2");
  }
});

// DELETE BILLS (new-user)
app.post("/new-user/delete-bills", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const ids = req.body.ids.split(",").map(id => parseInt(id));

    await db.query(`
      DELETE FROM bills
      WHERE username = $1 AND id = ANY($2)
    `, [username, ids]);

    const returnPage = req.query.page || 3;
    res.redirect(`/new-user?page=${returnPage}`);

  } catch (err) {
    console.error("new-user delete-bills error:", err);
    res.redirect("/new-user?page=3");
  }
});

// LEFTOVER ACTION (new-user)
app.post("/new-user/leftover-action", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { action, amount } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toLocaleDateString("en-CA"); // yyyy-mm-dd
    const cycleId = await getOrCreateCycle(username, todayISO);
    const val = parseFloat(amount) || 0;

    if (action === "use") {
      await db.query(`
        INSERT INTO incomes (username, cycle_id, name, value, type, status, date_created)
        VALUES ($1, $2, 'Rettifica', $3, 'income', 'confirmed', now())
      `, [username, cycleId, val]);
    } else {
      await db.query(`
        INSERT INTO savings (username, cycle_id, amount, source, created_at)
        VALUES ($1, $2, $3, 'leftover', now())
      `, [username, cycleId, val]);
    }

    res.redirect("/new-user?page=0");
  } catch (err) {
    console.error("new-user leftover-action error:", err);
    res.redirect("/new-user?page=0");
  }
});

// CONFIRM CYCLE (new-user)
app.post("/new-user/confirm", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { weeklyOriginal, weeklyNew } = req.body;

    // search payday
    const userRes = await db.query(`
      SELECT payday FROM users WHERE username = $1
    `, [username]);

    const payday = userRes.rows[0]?.payday;
    if (!payday) return res.redirect("/new-user?page=0");

    // cycle dates based on payday
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(today);

    let nextPayday = new Date(today.getFullYear(), today.getMonth(), payday);
    if (today.getDate() >= payday) {
      nextPayday.setMonth(nextPayday.getMonth() + 1);
    }

    const endDate = new Date(nextPayday);
    endDate.setDate(endDate.getDate() - 1);

    const startISO = startDate.toLocaleDateString("en-CA");
    const endISO = endDate.toLocaleDateString("en-CA");

    // real weeks between dates
    const weeks = getItalianWeeks(startDate, endDate);

    // Create cycle
    const cycleRes = await db.query(`
      INSERT INTO cycles (username, start_date, end_date, weeks_count)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [username, startISO, endISO, weeks]);

    const cycleId = cycleRes.rows[0].id;

    // tie incomes to cycle
    await db.query(`
      UPDATE incomes
      SET cycle_id = $1
      WHERE username = $2 AND cycle_id IS NULL
    `, [cycleId, username]);

    // tie bills to cycle
    await db.query(`
      UPDATE bills
      SET cycle_id = $1
      WHERE username = $2 AND cycle_id IS NULL
    `, [cycleId, username]);

    // Weekly original and new
    const orig = parseFloat(weeklyOriginal) || 0;
    const novo = parseFloat(weeklyNew) || 0;

    // block if user tries to increase weekly limit in the wizard
    if (novo > orig) {
      return res.redirect("/new-user?page=3");
    }

    // weekly iference
    const weeklyDiff = orig - novo;

    // total diference
    const totalDiff = weeklyDiff * weeks;

    if (totalDiff > 0) {
      await db.query(`
        INSERT INTO savings (username, cycle_id, amount, source, created_at)
        VALUES ($1, $2, $3, 'weekly-diff', now())
      `, [username, cycleId, totalDiff]);
    }

    res.redirect("/");

  } catch (err) {
    console.error("new-user confirm error:", err);
    res.redirect("/new-user?page=3");
  }
});

// server
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});
