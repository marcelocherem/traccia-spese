document.addEventListener("DOMContentLoaded", () => {
  // Detect witch section is active
  const sectionEl =
    document.querySelector("#home") ||
    document.querySelector("#family") ||
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

  // select the form accordin to the section
  const editForm =
    sectionId === "bills" || sectionId === "savings"
      ? document.getElementById("edit-bill-form")
      : sectionId === "family"
        ? document.getElementById("edit-family-form")
        : document.getElementById("edit-weekly-form");

  document.querySelectorAll(`${selector} .edit-btn`).forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();

      const id = button.dataset.id;
      const name = button.dataset.name;
      const value = button.dataset.value;

      if (!editForm) return;

      // Define the edition route
      editForm.action =
        sectionId === "bills"
          ? `/edit-bill/${id}`
          : sectionId === "savings"
            ? `/edit-savings/${id}`
            : sectionId === "family"
              ? `/edit-family/${id}`
              : `/edit-weekly_expenses/${id}`;

      // Fill the form fields
      document.getElementById("edit-name").value = name;
      document.getElementById("edit-value").value = value;

      if (sectionId === "bills" || sectionId === "savings") {
        document.getElementById("edit-day").value = button.dataset.day;
      } else {
        const dateField =
          sectionId === "family"
            ? document.querySelector("#edit-family-form input[name='date_created']")
            : document.getElementById("edit-date");
        if (dateField) dateField.value = button.dataset.date;
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
    // close edition form
    if (addOuter && addInner && addBtn) {
      const clickedInsideAdd = addInner.contains(event.target) || addBtn.contains(event.target);
      if (!clickedInsideAdd && !addOuter.classList.contains("hidden")) {
        addOuter.classList.add("hidden");
      }
    }

    // close edition form
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

// logout btn
function toggleLogout() {
  const btn = document.querySelector(".settings-btn");
  const form = document.querySelector(".logout-form");

  btn.classList.toggle("active");
  form.classList.toggle("hidden");
}

// Closing menu when clicking outside
document.addEventListener("click", function (event) {
  const dropdown = document.querySelector(".dropdown-menu");
  const btn = document.querySelector(".settings-btn");
  const form = document.querySelector(".logout-form");

  if (!dropdown.contains(event.target)) {
    btn.classList.remove("active");
    form.classList.add("hidden");
  }
});

// load new page
window.addEventListener("beforeunload", () => {
  document.getElementById("loader").classList.remove("hidden");
});

