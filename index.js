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

    // Buscar payday
    const paydayRes = await db.query(
      "SELECT payday FROM users WHERE username = $1",
      [username]
    );
    const payday = paydayRes.rows[0]?.payday || null;

    const today = new Date();
    const todayDay = today.getDate();

    // Buscar contas
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

    // Se não tem payday, só mostra esse alerta
    if (!payday) {
      res.locals.payday = null;
      res.locals.alerts = alerts;
      res.locals.alertCount = 1;
      return next();
    }

    // ---------------------------------------------------------
    // 1. MARCAR AUTOMÁTICAS COMO PAGAS AUTOMATICAMENTE
    // ---------------------------------------------------------
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

    // Recarregar contas após atualizar automáticas
    const billsRes2 = await db.query(
      "SELECT id, name, value, day, pago, tipo FROM bills WHERE username = $1",
      [username]
    );
    bills = billsRes2.rows;

    // ---------------------------------------------------------
    // 2. FILTRAR APENAS CONTAS MANUAIS NÃO PAGAS
    // ---------------------------------------------------------
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

    // ---------------------------------------------------------
    // 3. SEPARAR ENTRE "HOJE" E "ATRASADAS"
    // ---------------------------------------------------------
    for (const b of candidateBills) {
      if (b.day === todayDay) alerts.billsDue.push(b);
      else alerts.billsOverdue.push(b);
    }

    // Contagem total
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

app.post("/bills/:id/mark-paid", requireLogin, async (req, res) => {
  try {
    const id = req.params.id;

    await db.query(
      "UPDATE bills SET pago = true WHERE id = $1",
      [id]
    );

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Erro ao marcar como paga:", err);
    res.status(500).json({ error: "Erro no servidor" });
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

async function getOrCreateCycle(username, todayISO) {
  const existing = await db.query(`
    SELECT id, start_date, end_date, weeks_count
    FROM cycles
    WHERE username = $1
    ORDER BY id DESC
    LIMIT 1
  `, [username]);

  if (existing.rows.length > 0) {
    const cycle = existing.rows[0];
    const end = new Date(cycle.end_date);
    const today = new Date(todayISO);
    if (end >= today) return cycle.id;
  }

  const userRes = await db.query(`
    SELECT payday
    FROM users
    WHERE username = $1
    LIMIT 1
  `, [username]);

  let startISO, endISO, weeksCount;
  if (userRes.rows.length > 0 && userRes.rows[0].payday) {
    const paydayDay = parseInt(userRes.rows[0].payday, 10);
    const today = new Date(todayISO);
    let candidate = makeValidDate(today.getFullYear(), today.getMonth(), paydayDay);
    if (candidate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      candidate = makeValidDate(nextMonth.getFullYear(), nextMonth.getMonth(), paydayDay);
    }
    const range = computeCycleRangeFromStartDate(candidate);
    startISO = range.startISO;
    endISO = range.endISO;
    weeksCount = range.weeksCount;
  } else {
    const start = todayISO;
    const end = new Date(todayISO);
    end.setDate(end.getDate() + 27);
    startISO = start;
    endISO = end.toISOString().split("T")[0];
    weeksCount = 4;
  }

  const insert = await db.query(`
    INSERT INTO cycles (username, start_date, end_date, weeks_count)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [username, startISO, endISO, weeksCount]);

  return insert.rows[0].id;
}


// HOME PAGE
app.get("/", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;

    // finalize weeks
    await finalizePastWeeks(username);

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

function getWeekRange(date) {
  const d = new Date(date);
  const dayOfWeek = d.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

async function updateWeeklySummary(username, date) {
  const expenseDate = new Date(date);
  const { weekStart, weekEnd } = getWeekRange(expenseDate);

  const existingSummaryRes = await db.query(`
    SELECT weekly_limit, total_spent, is_final
    FROM weekly_summary
    WHERE username = $1 AND period_start = $2 AND period_end = $3
  `, [username, weekStart, weekEnd]);

  const existingSummary = existingSummaryRes.rows[0];

  if (existingSummary?.is_final) {
    const expensesRes = await db.query(`
      SELECT SUM(value) FROM weekly_expenses
      WHERE username = $1 AND date_expense BETWEEN $2 AND $3
    `, [username, weekStart, weekEnd]);

    const totalSpent = parseFloat(expensesRes.rows[0].sum) || 0;

    await db.query(`
      UPDATE weekly_summary
      SET total_spent = $1
      WHERE username = $2 AND period_start = $3 AND period_end = $4
    `, [totalSpent, username, weekStart, weekEnd]);

    return;
  }

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
  const billValues = billsRes.rows.map(b => parseFloat(b.value) || 0);
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

  if (!existingSummary) {
    await db.query(`
      INSERT INTO weekly_summary (username, period_start, period_end, weekly_limit, total_spent, is_final)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [username, weekStart, weekEnd, weeklyLimit, totalSpent, false]);
  } else {
    await db.query(`
      UPDATE weekly_summary
      SET weekly_limit = $1, total_spent = $2
      WHERE username = $3 AND period_start = $4 AND period_end = $5
    `, [weeklyLimit, totalSpent, username, weekStart, weekEnd]);
  }
}

// ADD WEEKLY EXPENSE

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

// EDIT WEEKLY EXPENSE
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

// DELETE WEEKLY EXPENSE
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
  const username = req.user.username;

  try {
    const paydayRes = await db.query("SELECT payday FROM users WHERE username = $1", [username]);
    const payday = paydayRes.rows[0]?.payday || null;

    const todayISO = new Date().toISOString().split("T")[0];
    const currentCycleId = await getOrCreateCycle(username, todayISO);

    await db.query(
      `UPDATE incomes
       SET status = 'active'
       WHERE username = $1
         AND cycle_id = $2
         AND type = 'salary'
         AND status = 'pending'`,
      [username, currentCycleId]
    );

    await db.query(
      `UPDATE incomes
       SET status = 'inactive'
       WHERE username = $1
         AND cycle_id <> $2
         AND type = 'salary'
         AND status = 'active'`,
      [username, currentCycleId]
    );

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

// ADD INCOME
app.post("/add-incomes", requireLogin, async (req, res) => {
  const { name, value, date_created, type } = req.body;
  const username = req.user.username;

  try {
    const cycleId = await getOrCreateCycle(username, date_created);
    const todayISO = new Date().toISOString().split("T")[0];
    const currentCycleId = await getOrCreateCycle(username, todayISO);

    let status = "pending";
    if ((type || "salary") === "salary" && cycleId === currentCycleId) {
      status = "active";
    }

    await db.query(
      `INSERT INTO incomes (name, value, date_created, type, username, cycle_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [name, value, date_created, type || "salary", username, cycleId, status]
    );

    res.redirect("/incomes");
  } catch (err) {
    console.error("Error :", err.message);
    res.status(500).send("Intern error");
  }
});

// EDIT INCOME
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

// DELETE INCOME
app.post("/delete-incomes/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const username = req.user.username;

  const check = await db.query("SELECT username FROM incomes WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Accesso negato.");

  await db.query("DELETE FROM incomes WHERE id = $1", [id]);
  res.redirect("/incomes");
});

// BILLS PAGE
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

// ADD BILL
app.post("/add-bill", requireLogin, async (req, res) => {
  const { name, value, day, tipo } = req.body;
  const username = req.user.username;

  try {
    await db.query(
      "INSERT INTO bills (name, value, day, tipo, savings, username) VALUES ($1, $2, $3, $4, false, $5)",
      [name, parseFloat(value), parseInt(day), tipo, username]
    );
    res.redirect("/bills");
  } catch (err) {
    console.error("Error adding bill:", err.message);
    res.status(500).send("Internal error");
  }
});

// EDIT BILL
app.post("/edit-bill/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const { name, value, day, tipo } = req.body;
  const username = req.user.username;

  const check = await db.query("SELECT username FROM bills WHERE id = $1", [id]);
  if (check.rows[0]?.username !== username) return res.status(403).send("Accesso negato.");

  try {
    await db.query(
      "UPDATE bills SET name = $1, value = $2, day = $3, tipo = $4, savings = false WHERE id = $5",
      [name, parseFloat(value), parseInt(day), tipo, id]
    );
    res.redirect("/bills");
  } catch (err) {
    console.error("Error editing bill:", err.message);
    res.status(500).send("Internal error");
  }
});

// DELETE BILL
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

// SAVINGS PAGE
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
    const todayISO = new Date().toISOString().split("T")[0];
    const cycleId = await getOrCreateCycle(username, todayISO);
    const cycleRes = await db.query(`
      SELECT id, start_date, end_date, weeks_count
      FROM cycles
      WHERE id = $1
    `, [cycleId]);

    const cycle = cycleRes.rows[0];
    const leftoverRes = await db.query(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM savings
      WHERE username = $1 AND cycle_id = $2 AND source = 'leftover'
    `, [username, cycleId]);

    const leftover = leftoverRes.rows[0].total || 0;
    const weekLeftoverRes = await db.query(`
      SELECT COALESCE(SUM(value), 0) AS total
      FROM weekly_expenses
      WHERE username = $1 AND cycle_id = $2
    `, [username, cycleId]);

    const weekLeftover = weekLeftoverRes.rows[0].total || 0;
    const incomesRes = await db.query(`
  SELECT id, name, value, type, status
  FROM incomes
  WHERE username = $1
    AND cycle_id = $2
    AND status IN ('active', 'confirmed')
  ORDER BY id DESC
`, [username, cycleId]);

    const incomes = incomesRes.rows;
    // bills
    const billsRes = await db.query(`
      SELECT id, name, value, day, tipo
      FROM bills
      WHERE username = $1
      ORDER BY day ASC
    `, [username]);

    const bills = billsRes.rows;
    const totalBills = bills.reduce((acc, b) => acc + parseFloat(b.value || 0), 0);
    const totalIncomes = incomes.reduce((acc, s) => acc + parseFloat(s.value || 0), 0);
    const totalSavings = leftover;
    const weeksCount = cycle.weeks_count || 4;
    const weeklyValue = (totalIncomes - totalBills) / weeksCount;

    
    res.render("new-cycle", {
      section: "new-cycle",
      cycle,
      leftover,
      weekLeftover,
      weeklyValue,
      incomes,
      bills
    });

  } catch (err) {
    console.error("Error loading new cycle:", err);
    res.redirect("/");
  }
});

// LEFTOVER ACTION (rettifica settimanale)
app.post("/new-cycle/leftover-action", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { action, amount } = req.body;

    const todayISO = new Date().toISOString().split("T")[0];
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

    res.redirect("/new-cycle?page=0");

  } catch (err) {
    console.error("leftover-action error:", err);
    res.redirect("/new-cycle?page=0");
  }
});

// ADD SALARY
app.post("/new-cycle/add-salary", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { name, value } = req.body;

    const todayISO = new Date().toISOString().split("T")[0];
    const cycleId = await getOrCreateCycle(username, todayISO);

    const val = parseFloat(value) || 0;

    await db.query(`
      INSERT INTO incomes (username, cycle_id, name, value, type, status, date_created)
      VALUES ($1, $2, $3, $4, 'salary', 'confirmed', now())
    `, [username, cycleId, name, val]);

    res.redirect("/new-cycle?page=1");

  } catch (err) {
    console.error("add-salary error:", err);
    res.redirect("/new-cycle?page=1");
  }
});

// DELETE BILLS
app.post("/new-cycle/delete-bills", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const ids = req.body.ids.split(",").map(id => parseInt(id));

    await db.query(`
      DELETE FROM bills
      WHERE username = $1 AND id = ANY($2)
    `, [username, ids]);

    res.json({ ok: true });

  } catch (err) {
    console.error("delete-bills error:", err);
    res.json({ ok: false, message: err.message });
  }
});


// add bill
app.post("/new-cycle/add-bill", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { name, value, day, tipo } = req.body;

    await db.query(`
      INSERT INTO bills (username, name, value, day, tipo)
      VALUES ($1, $2, $3, $4, $5)
    `, [username, name, parseFloat(value) || 0, parseInt(day) || 0, tipo]);

    // volta para a página de bills dentro do wizard
    res.redirect("/new-cycle?page=2");
  } catch (err) {
    console.error("new-cycle add-bill error:", err);
    res.redirect("/new-cycle?page=2");
  }
});

// CONFIRM CYCLE
app.post("/new-cycle/confirm", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { weeklyOriginal, weeklyNew } = req.body;

    const todayISO = new Date().toISOString().split("T")[0];
    const cycleId = await getOrCreateCycle(username, todayISO);

    const orig = parseFloat(weeklyOriginal) || 0;
    const novo = parseFloat(weeklyNew) || 0;

    const diff = orig - novo;

    if (diff > 0) {
      await db.query(`
        INSERT INTO savings (username, cycle_id, amount, source, created_at)
        VALUES ($1, $2, $3, 'weekly-diff', now())
      `, [username, cycleId, diff]);
    }

    res.redirect("/");

  } catch (err) {
    console.error("confirm cycle error:", err);
    res.redirect("/new-cycle?page=3");
  }
});









// NEW USER — GET PAGE
app.get("/new-user", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const todayISO = new Date().toISOString().split("T")[0];
    const cycleId = await getOrCreateCycle(username, todayISO); // cria ciclo fallback se necessário

    const cycleRes = await db.query(`
      SELECT id, start_date, end_date, weeks_count
      FROM cycles
      WHERE id = $1
    `, [cycleId]);

    const cycle = cycleRes.rows[0];

    // leftovers / weekLeftover / incomes / bills — mesma lógica do new-cycle
    const leftoverRes = await db.query(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM savings
      WHERE username = $1 AND cycle_id = $2 AND source = 'leftover'
    `, [username, cycleId]);
    const leftover = leftoverRes.rows[0].total || 0;

    const weekLeftoverRes = await db.query(`
      SELECT COALESCE(SUM(value), 0) AS total
      FROM weekly_expenses
      WHERE username = $1 AND cycle_id = $2
    `, [username, cycleId]);
    const weekLeftover = weekLeftoverRes.rows[0].total || 0;

    const incomesRes = await db.query(`
      SELECT id, name, value, type, status
      FROM incomes
      WHERE username = $1
        AND cycle_id = $2
        AND status IN ('active', 'confirmed')
      ORDER BY id DESC
    `, [username, cycleId]);
    const incomes = incomesRes.rows;

    const billsRes = await db.query(`
      SELECT id, name, value, day, tipo
      FROM bills
      WHERE username = $1
      ORDER BY day ASC
    `, [username]);
    const bills = billsRes.rows;

    const totalBills = bills.reduce((acc, b) => acc + parseFloat(b.value || 0), 0);
    const totalIncomes = incomes.reduce((acc, s) => acc + parseFloat(s.value || 0), 0);
    const weeksCount = cycle.weeks_count || 4;
    const weeklyValue = (totalIncomes - totalBills) / weeksCount;

    res.render("new-user", {
      section: "new-user",
      cycle,
      leftover,
      weekLeftover,
      weeklyValue,
      incomes,
      bills
    });

  } catch (err) {
    console.error("Error loading new user page:", err);
    res.redirect("/");
  }
});

// SET PAYDAY (recebe data ISO yyyy-mm-dd)
app.post("/new-user/set-payday", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { paydayDate } = req.body; // espera 'YYYY-MM-DD'
    const todayISO = new Date().toISOString().split("T")[0];
    const cycleId = await getOrCreateCycle(username, todayISO);

    // validação básica
    if (!paydayDate) {
      return res.redirect("/new-user?page=0");
    }

    // calcula end_date: próxima ocorrência do mesmo dia no mês seguinte menos 1 dia
    const start = new Date(paydayDate);
    // se start < today, assume próximo mês (evita ciclo no passado)
    const today = new Date(todayISO);
    if (start < today) {
      // avança um mês
      start.setMonth(start.getMonth() + 1);
    }
    const startISO = start.toISOString().split("T")[0];

    // próxima ocorrência: add 1 month (mantendo dia quando possível)
    const next = new Date(start);
    next.setMonth(next.getMonth() + 1);

    // se o dia não existir no próximo mês (ex: 31), Date ajusta automaticamente
    // end = next - 1 dia
    const end = new Date(next);
    end.setDate(end.getDate() - 1);
    const endISO = end.toISOString().split("T")[0];

    // weeks_count: número de semanas completas/semanais no período (arredonda para cima)
    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.round((end - start) / msPerDay) + 1;
    const weeksCount = Math.max(1, Math.ceil(days / 7));

    // atualiza o ciclo
    await db.query(`
      UPDATE cycles
      SET start_date = $1, end_date = $2, weeks_count = $3
      WHERE id = $4 AND username = $5
    `, [startISO, endISO, weeksCount, cycleId, username]);

    // opcional: salvar a data do payday em outra tabela (ex: user_settings) se desejar
    // await db.query(`INSERT INTO user_settings (username, key, value) VALUES ($1,'payday',$2) ON CONFLICT (...)`, [username, startISO]);

    res.redirect("/new-user?page=1");

  } catch (err) {
    console.error("set-payday error:", err);
    res.redirect("/new-user?page=0");
  }
});

// Duplicate endpoints for new-user to mirror new-cycle behavior (add-salary, add-bill, delete-bills, leftover-action, confirm)
// ADD SALARY (new-user)
app.post("/new-user/add-salary", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { name, value } = req.body;
    const todayISO = new Date().toISOString().split("T")[0];
    const cycleId = await getOrCreateCycle(username, todayISO);
    const val = parseFloat(value) || 0;

    await db.query(`
      INSERT INTO incomes (username, cycle_id, name, value, type, status, date_created)
      VALUES ($1, $2, $3, $4, 'salary', 'confirmed', now())
    `, [username, cycleId, name, val]);

    res.redirect("/new-user?page=1");
  } catch (err) {
    console.error("new-user add-salary error:", err);
    res.redirect("/new-user?page=1");
  }
});

// ADD BILL (new-user)
app.post("/new-user/add-bill", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { name, value, day, tipo } = req.body;

    await db.query(`
      INSERT INTO bills (username, name, value, day, tipo)
      VALUES ($1, $2, $3, $4, $5)
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
    res.json({ ok: true });
  } catch (err) {
    console.error("new-user delete-bills error:", err);
    res.json({ ok: false, message: err.message });
  }
});

// LEFTOVER ACTION (new-user) — mesma lógica do new-cycle
app.post("/new-user/leftover-action", requireLogin, async (req, res) => {
  try {
    const username = req.user.username;
    const { action, amount } = req.body;
    const todayISO = new Date().toISOString().split("T")[0];
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
    const todayISO = new Date().toISOString().split("T")[0];
    const cycleId = await getOrCreateCycle(username, todayISO);

    const orig = parseFloat(weeklyOriginal) || 0;
    const novo = parseFloat(weeklyNew) || 0;
    const diff = orig - novo;

    if (diff > 0) {
      await db.query(`
        INSERT INTO savings (username, cycle_id, amount, source, created_at)
        VALUES ($1, $2, $3, 'weekly-diff', now())
      `, [username, cycleId, diff]);
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
