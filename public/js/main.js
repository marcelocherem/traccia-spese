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

        const dateField = document.getElementById("edit-date");
        if (dateField) dateField.value = button.dataset.date || "";

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

// CONFIG / SETTINGS BUTTON
function toggleLogout() {
  const btn = document.querySelector(".settings-btn");
  if (btn) btn.classList.toggle("active");
}

// NAVIGATION LOADER
window.addEventListener("pageshow", () => {
  const loader = document.querySelector(".loader");
  if (loader) loader.classList.remove("visible");
});

document.querySelectorAll('a[href], button[data-navigate]').forEach(el => {
  el.addEventListener('click', (e) => {
    const loader = document.querySelector('.loader');
    if (loader) loader.classList.add('visible');

    const url = el.getAttribute('href');
    if (url) {
      e.preventDefault();
      setTimeout(() => {
        window.location.href = url;
      }, 200);
    }
  });
});

document.querySelectorAll("form").forEach(form => {
  form.addEventListener("submit", () => {
    const loader = document.querySelector(".loader");
    if (loader) loader.classList.add("visible");

    const btn = form.querySelector("button[type='submit']");
    if (btn) btn.disabled = true;
  });
});


// BILLS: PAID / UNPAID TOGGLE
document.querySelectorAll(".bill-option").forEach(option => {
  option.addEventListener("click", () => {
    document.querySelectorAll(".bill-option").forEach(o => o.classList.remove("active"));
    option.classList.add("active");

    const target = option.dataset.target;

    document.querySelectorAll(".entry-bills, .separator").forEach(el => {
      el.classList.add("hidden");
      if (el.classList.contains(target)) {
        el.classList.remove("hidden");
      }
    });
  });
});

const defaultOption = document.querySelector(".bill-option[data-target='paid']");
if (defaultOption) defaultOption.click();

// SETTINGS PAGE TOGGLE (payday / history)
document.addEventListener("DOMContentLoaded", () => {
  const btnPayday = document.querySelector(".container-payday");
  const btnHistory = document.querySelector(".container-history");

  const paydaySpace = document.querySelector(".payday-space");
  const historySpace = document.querySelector(".history");

  if (!btnPayday || !btnHistory || !paydaySpace || !historySpace) return;

  function clearActive() {
    document.querySelectorAll(".settings-btn").forEach(btn => {
      btn.classList.remove("active");
    });
  }

  btnPayday.addEventListener("click", () => {
    clearActive();
    btnPayday.classList.add("active");

    paydaySpace.classList.add("show");
    historySpace.classList.remove("show");
  });

  btnHistory.addEventListener("click", () => {
    clearActive();
    btnHistory.classList.add("active");

    paydaySpace.classList.remove("show");
    historySpace.classList.add("show");
  });
});

// BELL POPUP + MARK PAID
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
      try {
        await fetch(`/bills/${id}/mark-paid`, { method: "POST" });
        window.location.reload();
      } catch (err) {
        console.error("mark-paid error", err);
        alert("Errore di rete");
      }
    });
  });
})();

// SETTINGS ICON TOGGLE
const settingsBtn = document.getElementById("settingsBtn");
if (settingsBtn) {
  settingsBtn.addEventListener("click", function (e) {
    this.classList.toggle("toggled");
    toggleLogout();
  });
}

// NEW-CYCLE / NEW-USER: CAROUSEL + NUMBER PICKER + ADD SALARY
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
      if (index === 0 && document.querySelector(".start")) {
        titleEl.textContent = "Benvenuto";
      } else if (index === screens.length - 1) {
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

  // scroll number picker (new-cycle & new-user)
  const picker = document.querySelector(".number-picker");
  const input = document.getElementById("leftoverInput");
  const above = document.querySelector(".np-above");
  const below = document.querySelector(".np-below");

  function updateSideNumbers() {
    if (!input || !above || !below) return;
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
    if (!input) return;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startValue = parseFloat(input.value) || 0;
  }

  function duringDrag(e) {
    if (startY === null || !input) return;
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

  // TOGGLE add salary form (new-cycle & new-user)
  const containerNewSalary = document.querySelector(".container-new-salary");
  const addSalaryBtn = document.querySelector(".add-salary-new-cycle");
  if (addSalaryBtn && containerNewSalary) {
    addSalaryBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      containerNewSalary.classList.add("when-open");
    });
  }
});
// TOGGLE ADD-BILL FORM (new-cycle & new-user)
document.addEventListener("DOMContentLoaded", () => {
  const addBillBtn = document.querySelector(".add-bill-new-cycle");
  const addBillModal = document.querySelector(".container-add-bill");

  if (addBillBtn && addBillModal) {
    addBillBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      addBillModal.classList.remove("hidden");
    });

    // close when clicking outside
    document.addEventListener("click", (ev) => {
      const clickedInside = addBillModal.contains(ev.target) || addBillBtn.contains(ev.target);
      if (!clickedInside && !addBillModal.classList.contains("hidden")) {
        addBillModal.classList.add("hidden");
      }
    });
  }
});

// SECURITY HELPER
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}
