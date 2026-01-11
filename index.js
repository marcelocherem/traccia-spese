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
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "jwt_secret_key";

// Middleware for protection
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

// Logout
app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

// register
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


// Login
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

// payday, middleware global
// ALERT SYSTEM — middleware global (versão final, ordenada e limpa)
app.use(requireLogin, async (req, res, next) => {
  try {
    const username = req.user.username;

    // carregar payday
    const paydayRes = await db.query(
      "SELECT payday FROM users WHERE username = $1",
      [username]
    );
    const payday = paydayRes.rows[0]?.payday || null;

    const today = new Date();
    const todayDay = today.getDate();

    // carregar bills
    const billsRes = await db.query(
      "SELECT id, name, value, day, pago, tipo FROM bills WHERE username = $1",
      [username]
    );
    const bills = billsRes.rows;

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

    // LISTA FINAL DE CONTAS A ANALISAR
    let candidateBills = [];

    if (todayDay >= payday) {
      // CASO A: hoje >= payday
      candidateBills = bills.filter(b =>
        b.tipo === "manual" &&
        !b.pago &&
        b.day >= payday &&
        b.day <= todayDay
      );
    } else {
      // CASO B: hoje < payday
      candidateBills = bills.filter(b =>
        b.tipo === "manual" &&
        !b.pago &&
        (b.day >= payday || b.day <= todayDay)
      );
    }

    // ORDENAR POR DIA
    candidateBills.sort((a, b) => a.day - b.day);

    // CLASSIFICAR
    for (const b of candidateBills) {
      if (b.day === todayDay) {
        alerts.billsDue.push(b); // da pagare oggi
      } else {
        alerts.billsOverdue.push(b); // è scaduta
      }
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




// home page
app.get("/", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;

    // actual week range
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

    // active cycle
    const cycleRes = await db.query(`
      SELECT c.id, c.start_date, c.end_date,
             COALESCE(SUM(i.value),0) AS total_income
      FROM cycles c
      LEFT JOIN incomes i ON i.cycle_id = c.id
      WHERE c.username = $1
        AND c.start_date <= CURRENT_DATE
        AND c.end_date >= CURRENT_DATE
      GROUP BY c.id, c.start_date, c.end_date
    `, [username]);

    const cycle = cycleRes.rows[0];

    // Bills
    const billsRes = await db.query("SELECT value FROM bills WHERE username = $1", [username]);
    const billValues = billsRes.rows.map(b => parseFloat(b.value) || 0);
    const totalBills = billValues.reduce((acc, val) => acc + val, 0);

    // number of weeks in cycle
    let totalWeeks = 0;
    if (cycle) {
      const startDate = new Date(cycle.start_date);
      const endDate = new Date(cycle.end_date);

      // weeks starts in monday
      const startWeekMonday = new Date(startDate);
      startWeekMonday.setDate(startDate.getDate() - (startDate.getDay() === 0 ? 6 : startDate.getDay() - 1));
      const endWeekMonday = new Date(endDate);
      endWeekMonday.setDate(endDate.getDate() - (endDate.getDay() === 0 ? 6 : endDate.getDay() - 1));
      totalWeeks = Math.floor((endWeekMonday - startWeekMonday) / (1000 * 60 * 60 * 24 * 7)) + 1;
    }


    // weekly limit
    const weeklyLimit = cycle
      ? (parseFloat(cycle.total_income) - totalBills) / totalWeeks
      : 0;

    // weekly expenses
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

    // rettifica settimanale
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
    const userRes = await db.query("SELECT payday FROM users WHERE username = $1", [username]);
    const payday = userRes.rows[0]?.payday || null;


    res.render("index", {
      section: "home",
      expenses,
      total: visualSpent,
      limit: weeklyLimit,
      remaining: visualRemaining,
      weekLabel,
      showRetifica,
      retificaValue,
      cycle,
      payday
    });

  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send("internal error: " + err.message);
  }
});

// MARK bill as paid
app.post("/bills/:id/mark-paid", requireLogin, async (req, res) => {
  const id = Number(req.params.id);
  const username = req.user.username;

  try {
    await db.query(
      "UPDATE bills SET pago = true WHERE id = $1 AND username = $2",
      [id, username]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error marking bill paid:", err);
    res.status(500).json({ error: "Internal error" });
  }
});


// logic for weekly summary
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

  // active cycle for that date
  const cycleRes = await db.query(`
    SELECT c.id, c.start_date, c.end_date,
           COALESCE(SUM(i.value),0) AS total_income
    FROM cycles c
    LEFT JOIN incomes i ON i.cycle_id = c.id
    WHERE c.username = $1
      AND c.start_date <= $2
      AND c.end_date >= $2
    GROUP BY c.id, c.start_date, c.end_date
  `, [username, expenseDate]);

  const cycle = cycleRes.rows[0];

  // Bills
  const billsRes = await db.query("SELECT value FROM bills WHERE username = $1", [username]);
  const billValues = billsRes.rows.map(b => parseFloat(b.value));
  const totalBills = billValues.reduce((acc, val) => acc + val, 0);

  // number of weeks in cycle
  let totalWeeks = 4;
  if (cycle) {
    const startDate = new Date(cycle.start_date);
    const endDate = new Date(cycle.end_date);
    const diffDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    totalWeeks = Math.ceil(diffDays / 7);
  }

  // weekly limit
  const weeklyLimit = cycle
    ? (parseFloat(cycle.total_income) - totalBills) / totalWeeks
    : 0;

  // weekly expenses total
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

// function to get or create cycle
async function getOrCreateCycle(username, date) {
  const paydayRes = await db.query("SELECT payday FROM users WHERE username = $1", [username]);
  const payday = paydayRes.rows[0]?.payday;
  if (!payday) throw new Error("data di paga non impostata.");

  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  let startDate, endDate;

  if (day <= payday) {
    startDate = new Date(year, month, payday);
    endDate = new Date(year, month + 1, payday - 1);
  } else {
    startDate = new Date(year, month + 1, payday);
    endDate = new Date(year, month + 2, payday - 1);
  }

  const startISO = startDate.toISOString().split("T")[0];
  const endISO = endDate.toISOString().split("T")[0];

  const cycleRes = await db.query(
    `SELECT id FROM cycles WHERE username = $1 AND start_date = $2 AND end_date = $3`,
    [username, startISO, endISO]
  );

  // cycle exists, don't create new
  if (cycleRes.rows.length > 0) return cycleRes.rows[0].id;

  // create new cycle
  const weeksCount = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24 * 7));
  const newCycle = await db.query(
    `INSERT INTO cycles (username, start_date, end_date, weeks_count)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [username, startISO, endISO, weeksCount]
  );
  
  // update all bills to unpaid for new cycle
  await db.query(
    "UPDATE bills SET pago = false WHERE username = $1",
    [username]
  );

  return newCycle.rows[0].id;
}



// SET payday
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

// INCOMES page
app.get("/incomes", requireLogin, async (req, res) => {
  const username = req.user.username;

  try {
    const paydayRes = await db.query("SELECT payday FROM users WHERE username = $1", [username]);
    const payday = paydayRes.rows[0]?.payday || null;

    const result = await db.query(
      `SELECT c.id as cycle_id, c.start_date, c.end_date,
              i.id, i.name, i.value, i.date_created, i.type, i.status as income_status
       FROM cycles c
       LEFT JOIN incomes i ON i.cycle_id = c.id
       WHERE c.username = $1
         AND c.start_date::date <= CURRENT_DATE
         AND c.end_date::date   >= CURRENT_DATE
       ORDER BY i.date_created DESC`,
      [username]
    );

    function formatDate(date) {
      if (!date) return "";
      const d = new Date(date);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }

    const cycles = {};
    result.rows.forEach(row => {
      if (!cycles[row.cycle_id]) {
        cycles[row.cycle_id] = {
          id: row.cycle_id,
          start_date: formatDate(row.start_date),
          end_date: formatDate(row.end_date),
          incomes: [],
          total: 0
        };
      }
      if (row.id) {
        cycles[row.cycle_id].incomes.push({
          id: row.id,
          name: row.name,
          value: parseFloat(row.value),
          date_created: formatDate(row.date_created),
          date_created_raw: new Date(row.date_created).toISOString().split("T")[0],
          type: row.type,
          status: row.income_status
        });
        cycles[row.cycle_id].total += parseFloat(row.value);
      }
    });

    // send to EJS
    res.render("index", {
      section: "incomes",
      cycles: Object.values(cycles),
      payday
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).send("Intern error");
  }
});

// ADD incomes member
app.post("/add-incomes", requireLogin, async (req, res) => {
  const { name, value, date_created, type } = req.body;
  const username = req.user.username;

  try {
    const cycleId = await getOrCreateCycle(username, date_created);

    await db.query(
      `INSERT INTO incomes (name, value, date_created, type, username, cycle_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [name, value, date_created, type || "salary", username, cycleId]
    );

    res.redirect("/incomes");
  } catch (err) {
    console.error("Error :", err.message);
    res.status(500).send("Intern error");
  }
});

// EDIT incomes member
app.post("/edit-incomes/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const { name, value, date_created, type, status } = req.body;
  const username = req.user.username;

  const check = await db.query("SELECT username FROM incomes WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Accesso negato.");

  await db.query(
    "UPDATE incomes SET name = $1, value = $2, date_created = $3, type = $4, status = $5 WHERE id = $6",
    [name, value, date_created, type || "salary", status || "pending", id]
  );
  res.redirect("/incomes");
});

// DELETE incomes member
app.post("/delete-incomes/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const username = req.user.username;

  const check = await db.query("SELECT username FROM incomes WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Accesso negato.");

  await db.query("DELETE FROM incomes WHERE id = $1", [id]);
  res.redirect("/incomes");
});


// BILLS page
app.get("/bills", requireLogin, async (req, res) => {
  const username = req.user.username;
  const today = new Date();
  const todayDay = today.getDate();
  const salaryDay = 13;

  try {
    const result = await db.query(
      "SELECT id, name, value, day, tipo, pago FROM bills WHERE username = $1 AND savings = false",
      [username]
    );

    let total = 0;
    let totalDaPagare = 0;
    let totalPagato = 0;

    const paidBills = [];
    const unpaidBills = [];

    result.rows.forEach(item => {
      const value = parseFloat(item.value) || 0;
      const billDay = parseInt(item.day);

      let isPaid = false;

      if (item.tipo === "manual") {
        isPaid = item.pago === true;
      } else {
        if (todayDay >= salaryDay) {
          isPaid = billDay >= salaryDay && billDay <= todayDay;
        } else {
          isPaid = (billDay >= salaryDay) || (billDay <= todayDay);
        }
      }

      total += value;
      if (!isPaid) totalDaPagare += value;

      const bill = { ...item, value, isPaid };

      if (isPaid) paidBills.push(bill);
      else unpaidBills.push(bill);
    });

    totalPagato = total - totalDaPagare;

    paidBills.sort((a, b) => a.day - b.day);
    unpaidBills.sort((a, b) => a.day - b.day);

    const bills = [...paidBills, ...unpaidBills];

    res.render("index", {
      section: "bills",
      bills,
      total,
      totalDaPagare,
      totalPagato
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

// settings
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

// return for terminal
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});

