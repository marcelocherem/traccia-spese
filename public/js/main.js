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
document.querySelectorAll('a[href], button[data-navigate]').forEach(el => {
  el.addEventListener('click', (e) => {
    document.querySelector('.loader').classList.add('visible');

    const url = el.getAttribute('href');
    if (url) {
      e.preventDefault();
      setTimeout(() => {
        window.location.href = url;
      }, 200);
    }
  });
});

// pages paid and unpaid from bills
document.querySelectorAll(".bill-option").forEach(option => {
  option.addEventListener("click", () => {
    // remove active class
    document.querySelectorAll(".bill-option").forEach(o => o.classList.remove("active"));
    option.classList.add("active");

    const target = option.dataset.target;

    // show only the selected entries
    document.querySelectorAll(".entry-bills, .separator").forEach(el => {
      el.classList.add("hidden");
      if (el.classList.contains(target)) {
        el.classList.remove("hidden");
      }
    });
  });
});

// paid is default
const defaultOption = document.querySelector(".bill-option[data-target='paid']");
if (defaultOption) defaultOption.click();



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

    paydaySpace.classList.add("show");
    historySpace.classList.remove("show");
  });

  // HISTORY
  btnHistory.addEventListener("click", () => {
    clearActive();
    btnHistory.classList.add("active");

    paydaySpace.classList.remove("show");
    historySpace.classList.add("show");
  });
});


// bell
(function setupBellAlert() {
  const bell = document.getElementById("bell-alert");
  const popup = document.getElementById("bell-popup");

  if (!bell || !popup) return;

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    popup.classList.toggle("hidden");
  });

  document.addEventListener("click", () => {
    popup.classList.add("hidden");
  });

  const goBtn = document.getElementById("go-to-payday");
  if (goBtn) {
    goBtn.addEventListener("click", () => {
      window.location.href = "/settings?open=payday";
    });
  }

  document.querySelectorAll(".mark-paid").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      await fetch(`/bills/${id}/mark-paid`, { method: "POST" });
      window.location.reload();
    });
  });
})();

// settings icon toggle
document.getElementById("settingsBtn").addEventListener("click", function (e) {
  this.classList.toggle("toggled");
  toggleLogout();
});


// weekly limit number picker
const picker = document.querySelector(".number-picker");
const input = document.getElementById("leftoverInput");
const above = document.querySelector(".np-above");
const below = document.querySelector(".np-below");

function updateSideNumbers() {
  const value = parseInt(input.value) || 0;
  above.textContent = value - 1;
  below.textContent = value + 1;
}

updateSideNumbers();

let startY = null;
let startValue = null;

function startDrag(e) {
  startY = e.touches ? e.touches[0].clientY : e.clientY;
  startValue = parseFloat(input.value);
}

function duringDrag(e) {
  if (startY === null) return;

  const currentY = e.touches ? e.touches[0].clientY : e.clientY;
  const diff = startY - currentY;

  const step = Math.round(diff / 10);

  input.value = Math.max(0, startValue + step);

  updateSideNumbers();
}

function endDrag() {
  startY = null;
  startValue = null;
}

picker.addEventListener("mousedown", startDrag);
picker.addEventListener("mousemove", duringDrag);
picker.addEventListener("mouseup", endDrag);
picker.addEventListener("mouseleave", endDrag);
picker.addEventListener("touchstart", startDrag);
picker.addEventListener("touchmove", duringDrag);
picker.addEventListener("touchend", endDrag);
input.addEventListener("input", updateSideNumbers);

// toggle add salary form
const container = document.querySelector(".container-new-salary");

container.addEventListener("click", () => {
  container.classList.add("when-open");
});

// next and back buttons new cycle
// public/js/new-cycle.js

document.addEventListener("DOMContentLoaded", () => {
  // Carousel
  const carousel = document.querySelector('.bg-new-cycle .body-int .carousel');
  const nextBtn = document.querySelector('.bg-new-cycle .new-cycle-actions .next');
  const backBtn = document.querySelector('.bg-new-cycle .new-cycle-actions .back');
  const titleEl = document.querySelector('.new-cycle-title h1');

  if (carousel && nextBtn && backBtn && titleEl) {
    const screens = document.querySelectorAll('.bg-new-cycle .body-int .carousel > *');
    const params = new URLSearchParams(window.location.search);
    let index = parseInt(params.get("page")) || 0;


    function updateTitle() {
      if (index === screens.length - 1) {
        titleEl.textContent = "Ci siamo";
      } else {
        titleEl.textContent = "Oggi è il payday";
      }
    }

    function updateButtons() {
      backBtn.style.visibility = index === 0 ? "hidden" : "visible";
      nextBtn.style.visibility = index === screens.length - 1 ? "hidden" : "visible";
    }

    function updatePosition() {
      carousel.style.transition = "transform 0.3s ease";
      carousel.style.transform = `translateX(-${index * 100}%)`;
      updateButtons();
      updateTitle();
    }

    nextBtn.addEventListener('click', () => {
      if (index < screens.length - 1) {
        index++;
        updatePosition();
      }
    });

    backBtn.addEventListener('click', () => {
      if (index > 0) {
        index--;
        updatePosition();
      }
    });

    updateButtons();
    updateTitle();
    carousel.style.transition = "none";
    updatePosition();
    requestAnimationFrame(() => {
      carousel.style.transition = "transform 0.3s ease";
    });

    // swipe
    let startX = 0, startY = 0, currentX = 0, currentY = 0, isDragging = false, moved = false, isHorizontal = false;
    const threshold = 50;

    function onTouchStart(e) {
      if (e.touches.length !== 1) return;
      isDragging = true; moved = false; isHorizontal = false;
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      carousel.style.transition = "none";
    }
    function onTouchMove(e) {
      if (!isDragging) return;
      currentX = e.touches[0].clientX; currentY = e.touches[0].clientY;
      const deltaX = currentX - startX; const deltaY = currentY - startY;
      if (!moved) {
        if (Math.abs(deltaY) > Math.abs(deltaX)) { isDragging = false; return; }
        else isHorizontal = true;
      }
      moved = true;
      if (isHorizontal) {
        carousel.style.transform = `translateX(calc(-${index * 100}% + ${deltaX}px))`;
      }
    }
    function onTouchEnd() {
      if (!isDragging) return;
      isDragging = false;
      const deltaX = currentX - startX;
      if (!moved || !isHorizontal) { carousel.style.transition = "transform 0.3s ease"; updatePosition(); return; }
      if (deltaX < -threshold && index < screens.length - 1) index++;
      else if (deltaX > threshold && index > 0) index--;
      carousel.style.transition = "transform 0.3s ease";
      updatePosition();
    }

    carousel.addEventListener("touchstart", onTouchStart, { passive: true });
    carousel.addEventListener("touchmove", onTouchMove, { passive: true });
    carousel.addEventListener("touchend", onTouchEnd);
  }

  // scroll number picker
  const picker = document.querySelector(".number-picker");
  const input = document.getElementById("leftoverInput");
  const above = document.querySelector(".np-above");
  const below = document.querySelector(".np-below");

  function updateSideNumbers() {
    const value = parseInt(input.value) || 0;
    above.textContent = value - 1;
    below.textContent = value + 1;
  }
  if (input) {
    updateSideNumbers();
  }

  let startY = null;
  let startValue = null;

  function startDrag(e) {
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startValue = parseFloat(input.value) || 0;
  }

  function duringDrag(e) {
    if (startY === null) return;
    const currentY = e.touches ? e.touches[0].clientY : e.clientY;
    const diff = startY - currentY;
    const step = Math.round(diff / 10);
    input.value = Math.max(0, startValue + step);
    updateSideNumbers();
  }

  function endDrag() {
    startY = null; startValue = null;
  }

  if (picker) {
    picker.addEventListener("mousedown", startDrag);
    picker.addEventListener("mousemove", duringDrag);
    picker.addEventListener("mouseup", endDrag);
    picker.addEventListener("mouseleave", endDrag);
    picker.addEventListener("touchstart", startDrag);
    picker.addEventListener("touchmove", duringDrag);
    picker.addEventListener("touchend", endDrag);
  }
  if (input) input.addEventListener("input", updateSideNumbers);

  // TOGGLE add salary form
  const containerNewSalary = document.querySelector(".container-new-salary");
  const addSalaryBtn = document.querySelector(".add-salary-new-cycle");
  if (addSalaryBtn && containerNewSalary) {
    addSalaryBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      containerNewSalary.classList.add("when-open");
    });
  }

  // REST
  const forSavingsBtn = document.querySelector(".for-savings");
  const forUseBtn = document.querySelector(".for-use");
  const restSpan = document.querySelector(".rest h2 span");

  function parseAmountFromSpan(spanEl) {
    if (!spanEl) return 0;
    const raw = spanEl.textContent || "";
    const num = raw.replace(/[^\d\-,.]/g, "").replace(",", ".");
    return Math.abs(parseFloat(num) || 0);
  }

  async function sendLeftover(action) {
    const amount = parseAmountFromSpan(restSpan);
    try {
      const res = await fetch("/new-cycle/leftover-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action === 'use' ? 'use' : 'savings', amount })
      });
      const data = await res.json();
      if (data.ok) {
        const restEl = document.querySelector(".rest");
        if (restEl) {
          restEl.style.display = "none";
          const msg = document.createElement("p");
          msg.className = "rest-feedback";
          msg.textContent = action === 'use' ? "Valore aggiunto come entrata." : "Valore aggiunto ai risparmi.";
          restEl.parentElement.prepend(msg);
        }
      } else {
        alert("Errore: " + (data.message || "Operazione fallita"));
      }
    } catch (err) {
      console.error("sendLeftover error", err);
      alert("Errore di rete");
    }
  }

  if (forUseBtn) forUseBtn.addEventListener("click", () => sendLeftover("use"));
  if (forSavingsBtn) forSavingsBtn.addEventListener("click", () => sendLeftover("savings"));

  // ADD SALARY
  const addSalaryForm = document.querySelector(".form-add-salary-new-cycle");

  async function updateSalariesTotal() {
    const vals = Array.from(document.querySelectorAll(".salaries-new-cycle .expense-value"))
      .map(el => parseFloat(el.textContent.replace(/[^\d\-,.]/g, '').replace(',', '.')) || 0);

    const total = vals.reduce((a, b) => a + b, 0);
    const totalEl = document.querySelector(".total h2");

    if (totalEl) totalEl.textContent = total.toFixed(2) + " €";
  }

  updateSalariesTotal();

  // DELETE BILLS
  const trashBtn = document.querySelector(".bills-container .trash");
  if (trashBtn) {
    trashBtn.addEventListener("click", async () => {
      const checked = Array.from(document.querySelectorAll(".bills .bill input.checkbox:checked"))
        .map(cb => {
          const billEl = cb.closest(".bill");
          return billEl ? parseInt(billEl.dataset.id) : null;
        })
        .filter(Boolean);

      if (checked.length === 0) return alert("Seleziona almeno una spesa.");
      if (!confirm(`Sei sicuro di eliminare ${checked.length} spesa/e?`)) return;

      try {
        const res = await fetch("/new-cycle/delete-bills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: checked })
        });
        const data = await res.json();
        if (data.ok) {
          checked.forEach(id => {
            const el = document.querySelector(`.bill[data-id="${id}"]`);
            if (el) el.remove();
          });
        } else {
          alert("Errore eliminazione");
        }
      } catch (err) {
        console.error("delete-bills error", err);
        alert("Errore di rete");
      }
    });
  }

  // CONFIRM CYCLE (final button)
  const endBtn = document.querySelector(".end-btn");
  if (endBtn) {
    endBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const weeklyOriginalEl = document.querySelector("#weekly-original");
      const weeklyOriginal = weeklyOriginalEl
        ? parseFloat(weeklyOriginalEl.dataset.value || 0)
        : 0;

      const weeklyNew = parseFloat(document.getElementById("leftoverInput").value || 0);

      try {
        const form = new FormData();
        form.append("weeklyOriginal", weeklyOriginal);
        form.append("weeklyNew", weeklyNew);

        const res = await fetch("/new-cycle/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weeklyOriginal, weeklyNew })
        });
        if (res.redirected) {
          window.location.href = res.url;
        } else {
          window.location.href = "/";
        }
      } catch (err) {
        console.error("confirm error", err);
        alert("Errore di rete");
      }
    });
  }
  // security helper
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
});

const addBillBtn = document.querySelector(".add-bill-new-cycle");
const addBillModal = document.querySelector(".container-add-bill");

if (addBillBtn && addBillModal) {
  addBillBtn.addEventListener("click", () => {
    addBillModal.classList.remove("hidden");
  });
}
