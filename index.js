import express from "express";
import pg from "pg";
import bodyParser from "body-parser";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "traccia spese",
    password: "1431",
    port: 5432,
});

const app = express();
const port = 3000;
db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

app.get("/", async (req, res) => {
    try {
        // Current week (Monday to Sunday)
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday...
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() + diffToMonday);
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        const weekLabel = `${weekStart.toLocaleDateString("en-GB", { day: '2-digit', month: 'short' })} - ${weekEnd.toLocaleDateString("en-GB", { day: '2-digit', month: 'short' })}`;

        // Period from the 13th of one month to the 13th of the next
        const year = today.getFullYear();
        const month = today.getDate() >= 13 ? today.getMonth() : today.getMonth() - 1;

        const periodStart = new Date(year, month, 13);
        const periodEnd = new Date(year, month + 1, 13);


        // Count weeks including partial ones
        function countWeeksBetween(startDate, endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);

            // Align start to Monday
            const startDay = start.getDay();
            const diffToMonday = startDay === 0 ? -6 : 1 - startDay;
            start.setDate(start.getDate() + diffToMonday);

            // Align end to Sunday
            const endDay = end.getDay();
            const diffToSunday = endDay === 0 ? 0 : 7 - endDay;
            end.setDate(end.getDate() + diffToSunday);

            const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            return Math.ceil(totalDays / 7);
            
        }

        const totalWeeks = countWeeksBetween(periodStart, periodEnd);

        // Income
        const incomeRes = await db.query("SELECT value FROM family");
        const incomeValues = incomeRes.rows.map(e => parseFloat(e.value));
        const totalIncome = incomeValues.reduce((acc, val) => acc + val, 0);

        // Fixed bills
        const billsRes = await db.query("SELECT value FROM bills");
        const billValues = billsRes.rows.map(d => parseFloat(d.value));
        const totalBills = billValues.reduce((acc, val) => acc + val, 0);

        // Weekly limit
        const weeklyLimit = (totalIncome - totalBills) / totalWeeks;
        
        // Weekly expenses
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

        // Render home page
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

app.get("/family", async (req, res) => {
    try {
        const result = await db.query("SELECT name, value FROM family ORDER BY name");
        const entrys = result.rows.map(item => ({
            ...item,
            value: parseFloat(item.value)
        }));

        const total = entrys.reduce((acc, item) => acc + parseFloat(item.value), 0);

        res.render("index", {
            section: "family",
            entrys,
            total
        });
    } catch (err) {
        console.error("error:", err);
        res.status(500).send("Intern error");
    }
});

// entering new family member
app.post("/add-family", async (req, res) => {
    const { name, value, date_created } = req.body;
  
    try {
      await db.query(
        "INSERT INTO family (name, value, date_created) VALUES ($1, $2, $3)",
        [name, parseFloat(value), date_created]
      );
      res.redirect("/family");
    } catch (err) {
      console.error("Error adding family member:", err.message);
      res.status(500).send("Internal server error");
    }
  });

app.get("/bills", async (req, res) => {
    try {
        const result = await db.query("SELECT name, value FROM bills ORDER BY name");
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
        res.status(500).send("Intern error" + err.message);
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
    

app.listen(port, () => {
    console.log(`Server running on port ${port}.`);
});