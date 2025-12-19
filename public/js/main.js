document.addEventListener("DOMContentLoaded", () => {
  // Detect which section is active
  const sectionEl =
    document.querySelector("#home") ||
    document.querySelector("#incomes") ||
    document.querySelector("#bills") ||
    document.querySelector("#savings");
  if (!sectionEl) return;

  const sectionId = sectionEl.id;
  const selector = `#${sectionId}`;

  // Fill in today's date in the date field (if it exists and is empty)
  const dateInputs = document.querySelectorAll(`${selector} input[type="date"]`);
  const today = new Date().toISOString().split("T")[0];
  dateInputs.forEach(input => {
    if (!input.value) input.value = today;
  });

  // open/close add form
  const addBtn = sectionEl.querySelector(".new-spese");
  const addOuter = sectionEl.querySelector(".container-plus-btn");
  const addInner = addOuter?.querySelector(".container");

  addBtn?.addEventListener("click", () => {
    addOuter.classList.toggle("hidden");
  });

  // open edition form
  const editOuter = document.querySelector(`${selector} .container-edit-btn`);
  const editInner = editOuter?.querySelector(".container");

  // select the form according to the section
  const editForm =
    sectionId === "bills" || sectionId === "savings"
      ? document.getElementById("edit-bill-form")
      : sectionId === "incomes"
        ? document.getElementById("edit-incomes-form")
        : document.getElementById("edit-weekly-form");

  // handle edit buttons
  document.querySelectorAll(`${selector} .edit-btn`).forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();

      const id = button.dataset.id;
      if (!editForm) return;

      // Define the edition route
      editForm.action =
        sectionId === "bills"
          ? `/edit-bill/${id}`
          : sectionId === "savings"
            ? `/edit-savings/${id}`
            : sectionId === "incomes"
              ? `/edit-incomes/${id}`
              : `/edit-weekly_expenses/${id}`;

      // Fill the form fields depending on section
      if (sectionId === "bills" || sectionId === "savings") {
        document.getElementById("edit-name").value = button.dataset.name || "";
        document.getElementById("edit-value").value = button.dataset.value || "";
        document.getElementById("edit-day").value = button.dataset.day || "";
      } else if (sectionId === "incomes") {
        document.getElementById("edit-name").value = button.dataset.name || "";
        document.getElementById("edit-value").value = button.dataset.value || "";

        // date must be yyyy-mm-dd
        const dateField = document.getElementById("edit-date");
        if (dateField) dateField.value = button.dataset.date || "";

        // tipo e stato
        const typeField = document.getElementById("edit-type");
        if (typeField) typeField.value = button.dataset.type || "";
      } else {
        // weekly expenses
        document.getElementById("edit-name").value = button.dataset.name || "";
        document.getElementById("edit-value").value = button.dataset.value || "";
        const dateField = document.getElementById("edit-date");
        if (dateField) dateField.value = button.dataset.date || "";
      }

      editOuter?.classList.remove("hidden");
    });
  });

  // confirm before delete
  document.querySelectorAll(`${selector} .delete-form`).forEach(form => {
    form.addEventListener("submit", event => {
      const msg =
        sectionId === "bills"
          ? "Sei sicuro di voler eliminare questa spesa?"
          : sectionId === "savings"
            ? "Sei sicuro di voler eliminare questo risparmio?"
            : "Sei sicuro di voler eliminare questa entry?";
      if (!confirm(msg)) {
        event.preventDefault();
      }
    });
  });

  // highlight selected entry
  const entries = document.querySelectorAll(`${selector} .entry`);
  entries.forEach(item => {
    item.addEventListener("click", () => {
      entries.forEach(el => el.classList.remove("active"));
      item.classList.add("active");
    });
  });

  // close forms and remove highlight when clicked outside
  document.addEventListener("click", event => {
    // close add form
    if (addOuter && addInner && addBtn) {
      const clickedInsideAdd = addInner.contains(event.target) || addBtn.contains(event.target);
      if (!clickedInsideAdd && !addOuter.classList.contains("hidden")) {
        addOuter.classList.add("hidden");
      }
    }

    // close edit form
    if (editOuter && editInner) {
      const clickedInsideEdit = editInner.contains(event.target) || event.target.closest(".edit-btn");
      if (!clickedInsideEdit && !editOuter.classList.contains("hidden")) {
        editOuter.classList.add("hidden");
      }
    }

    // Remove entry highlighted
    if (entries?.length) {
      const clickedInsideEntry = [...entries].some(el => el.contains(event.target));
      if (!clickedInsideEntry) {
        entries.forEach(el => el.classList.remove("active"));
      }
    }
  });
});

// config
function toggleLogout() {
  const btn = document.querySelector(".settings-btn");
  btn.classList.toggle("active");
}

// load new page
window.addEventListener("beforeunload", () => {
  document.getElementById("loader").classList.remove("hidden");
});


// pages paid and unpaid from bills
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const target = btn.dataset.target;

    document.querySelectorAll(".entry-bills, .separator").forEach(el => {
      el.classList.add("hidden");
      if (el.classList.contains(target)) {
        el.classList.remove("hidden");
      }
    });
  });
});
// fake click to show paid bills by default
const defaultBtn = document.querySelector(".filter-btn[data-target='paid']");
if (defaultBtn) defaultBtn.click();

// settings buttons
document.addEventListener("DOMContentLoaded", () => {
  const btnPayday = document.querySelector(".container-payday");
  const btnHistory = document.querySelector(".container-history");

  const paydaySpace = document.querySelector(".payday-space");
  const historySpace = document.querySelector(".history");

// clean active
  function clearActive() {
    document.querySelectorAll(".settings-btn").forEach(btn => {
      btn.classList.remove("active");
    });
  }

  // PAYDAY
  btnPayday.addEventListener("click", () => {
    clearActive();
    btnPayday.classList.add("active");

    paydaySpace.style.display = "flex";
    historySpace.style.display = "none";
  });

  // HISTORY
  btnHistory.addEventListener("click", () => {
    clearActive();
    btnHistory.classList.add("active");

    paydaySpace.style.display = "none";
    historySpace.style.display = "flex";
  });
});
