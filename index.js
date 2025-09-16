import express from "express";
import pg from "pg";
import bodyParser from "body-parser";
import dotenv from "dotenv";

dotenv.config();
console.log("DATABASE_URL:", process.env.DATABASE_URL);

const db = new pg.Client({
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

app.get("/", async (req, res) => {
    try {
      // 📅 Semana atual (segunda a domingo)
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0 = domingo, 1 = segunda...
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() + diffToMonday);
      weekStart.setHours(0, 0, 0, 0);
  
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
  
      const weekLabel = `${weekStart.toLocaleDateString("en-GB", { day: '2-digit', month: 'short' })} - ${weekEnd.toLocaleDateString("en-GB", { day: '2-digit', month: 'short' })}`;
  
      // 📆 Período mensal (13 a 13)
      const year = today.getFullYear();
      const month = today.getDate() >= 13 ? today.getMonth() : today.getMonth() - 1;
  
      const periodStart = new Date(year, month, 13);
      const periodEnd = new Date(year, month + 1, 13);
  
      // 🔢 Contar semanas no período
      function countWeeksBetween(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
  
        const startDay = start.getDay();
        const diffToMonday = startDay === 0 ? -6 : 1 - startDay;
        start.setDate(start.getDate() + diffToMonday);
  
        const endDay = end.getDay();
        const diffToSunday = endDay === 0 ? 0 : 7 - endDay;
        end.setDate(end.getDate() + diffToSunday);
  
        const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        return Math.ceil(totalDays / 7);
      }
  
      const totalWeeks = countWeeksBetween(periodStart, periodEnd);
  
      // 💰 Receitas
      const incomeRes = await db.query("SELECT value FROM family");
      const incomeValues = incomeRes.rows.map(e => parseFloat(e.value));
      const totalIncome = incomeValues.reduce((acc, val) => acc + val, 0);
  
      // 🧾 Contas fixas
      const billsRes = await db.query("SELECT value FROM bills");
      const billValues = billsRes.rows.map(d => parseFloat(d.value));
      const totalBills = billValues.reduce((acc, val) => acc + val, 0);
  
      // 📉 Limite semanal
      const weeklyLimit = (totalIncome - totalBills) / totalWeeks;
  
      // 🔄 Correção automática da semana anterior
      const prevWeekStart = new Date(weekStart);
      prevWeekStart.setDate(weekStart.getDate() - 7);
      prevWeekStart.setHours(0, 0, 0, 0);
  
      const prevWeekEnd = new Date(prevWeekStart);
      prevWeekEnd.setDate(prevWeekStart.getDate() + 6);
      prevWeekEnd.setHours(23, 59, 59, 999);
  
      const prevExpensesRes = await db.query(
        "SELECT value FROM weekly_expenses WHERE date_expense BETWEEN $1 AND $2",
        [prevWeekStart, prevWeekEnd]
      );
      const prevExpenses = prevExpensesRes.rows.map(e => parseFloat(e.value));
      const prevTotalSpent = prevExpenses.reduce((acc, val) => acc + val, 0);
      const prevRemaining = weeklyLimit - prevTotalSpent;
  
      const correctionCheck = await db.query(
        "SELECT * FROM weekly_expenses WHERE name = $1 AND date_expense BETWEEN $2 AND $3",
        ["rettifica settimana precedente", weekStart, weekEnd]
      );
  
      if (correctionCheck.rows.length === 0 && prevRemaining !== 0) {
        const correctionValue = Math.abs(prevRemaining);
        const correctionSign = prevRemaining < 0 ? correctionValue : -correctionValue;
  
        const sundayPrev = new Date(prevWeekEnd);
        const mondayCurrent = new Date(weekStart);
  
        await db.query(
          "INSERT INTO weekly_expenses (name, value, date_expense) VALUES ($1, $2, $3)",
          ["rettifica settimana precedente", correctionSign, mondayCurrent]
        );
  
        await db.query(
          "INSERT INTO weekly_expenses (name, value, date_expense) VALUES ($1, $2, $3)",
          ["rettifica settimana precedente", -correctionSign, sundayPrev]
        );
      }
  
      // 🧾 Despesas semana atual
      const expensesRes = await db.query(
        "SELECT id, name, value, date_expense FROM weekly_expenses WHERE date_expense BETWEEN $1 AND $2 ORDER BY date_expense DESC",
        [weekStart, weekEnd]
      );
  
      const expenses = expensesRes.rows.map(exp => ({
        ...exp,
        value: parseFloat(exp.value)
      }));
  
      const totalSpent = expenses.reduce((acc, exp) => acc + exp.value, 0);
      const remainingBudget = weeklyLimit - totalSpent;
  
      res.render("index", {
        section: "home",
        expenses,
        total: totalSpent,
        limit: weeklyLimit,
        remaining: remainingBudget,
        weekLabel
      });
    } catch (err) {
      console.error("Error loading Home page:", err.message);
      res.status(500).send("Internal server error: " + err.message);
    }
  });

app.post("/add-weekly_expenses", async (req, res) => {
    const { name, value, date_expense } = req.body;

    try {
        await db.query(
            "INSERT INTO weekly_expenses (name, value, date_expense) VALUES ($1, $2, $3)",
            [name, parseFloat(value), date_expense]
        );
        res.redirect("/");
    } catch (err) {
        console.error("Error adding expense:", err.message);
        res.status(500).send("Internal server error");
    }
});

app.post("/edit-weekly_expenses/:id", async (req, res) => {
    const { id } = req.params;
    const { name, value, date_expense } = req.body;
  
    try {
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

  app.post("/delete-weekly_expenses/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await db.query("DELETE FROM weekly_expenses WHERE id = $1", [id]);
      res.redirect("/");
    } catch (err) {
      console.error("Error deleting expense:", err.message);
      res.status(500).send("Internal server error");
    }
  });
  

app.get("/family", async (req, res) => {
    try {
      const result = await db.query("SELECT id, name, value, date_created FROM family ORDER BY name");
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
  

// entering new family member
app.post("/add-family", async (req, res) => {
    const { name, value, date_created } = req.body;
    await db.query("INSERT INTO family (name, value, date_created) VALUES ($1, $2, $3)", [name, value, date_created]);
    res.redirect("/family");
});

app.post("/edit-family/:id", async (req, res) => {
    const { id } = req.params;
    const { name, value, date_created } = req.body;
    await db.query("UPDATE family SET name = $1, value = $2, date_created = $3 WHERE id = $4", [name, value, date_created, id]);
    res.redirect("/family");
});

app.post("/delete-family/:id", async (req, res) => {
    const { id } = req.params;
    await db.query("DELETE FROM family WHERE id = $1", [id]);
    res.redirect("/family");
});


app.get("/bills", async (req, res) => {
    try {
        const result = await db.query("SELECT id, name, value, day FROM bills ORDER BY name");
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

app.post("/add-bill", async (req, res) => {
    const { name, value, day } = req.body;
    try {
        await db.query(
            "INSERT INTO bills (name, value, day) VALUES ($1, $2, $3)",
            [name, parseFloat(value), parseInt(day)]
        );
        res.redirect("/bills");
    } catch (err) {
        console.error("Error adding bill:", err.message);
        res.status(500).send("Internal server error");
    }
});

app.post("/edit-bill/:id", async (req, res) => {
    const { id } = req.params;
    const { name, value, day } = req.body;
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

app.post("/delete-bill/:id", async (req, res) => {
    const { id } = req.params;
    try {
        await db.query("DELETE FROM bills WHERE id = $1", [id]);
        res.redirect("/bills");
    } catch (err) {
        console.error("Error deleting bill:", err.message);
        res.status(500).send("Internal server error");
    }
});



app.listen(port, () => {
    console.log(`Server running on port ${port}.`);
});