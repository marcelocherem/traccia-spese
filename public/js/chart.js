
document.addEventListener("DOMContentLoaded", () => {
    // Set today's date in the input field (used on homepage)
    const dateInput = document.querySelector("input[name='date_expense']");
    if (dateInput) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
    }

    // Handle "Add" form toggle
    const addBtn = document.querySelector(".new-spese");
    const addOuter = document.querySelector(".container-plus-btn");
    const addInner = addOuter.querySelector(".container");

    addBtn.addEventListener("click", () => {
        addOuter.classList.toggle("hidden");
    });

    // Handle "Edit" form open and populate
    const editOuter = document.querySelector(".container-edit-btn");
    const editInner = editOuter.querySelector(".container");
    const editForm = document.getElementById("edit-bill-form");

    document.querySelectorAll(".edit-btn").forEach(button => {
        button.addEventListener("click", (event) => {
            event.stopPropagation(); // Prevent conflict with .entrata click

            const id = button.dataset.id;
            const name = button.dataset.name;
            const value = button.dataset.value;
            const day = button.dataset.day;

            editForm.action = `/edit-bill/${id}`;
            document.getElementById("edit-name").value = name;
            document.getElementById("edit-value").value = value;
            document.getElementById("edit-day").value = day;

            editOuter.classList.remove("hidden");
        });
    });

    // Show confirmation before deleting a bill
    document.querySelectorAll(".delete-form").forEach(form => {
        form.addEventListener("submit", (event) => {
            const confirmed = confirm("Sei sicuro di voler eliminare questa spesa?");
            if (!confirmed) {
                event.preventDefault(); // Cancel form submission
            }
        });
    });

    // Highlight clicked .entrata and show action buttons
    const entratas = document.querySelectorAll(".entrata");

    entratas.forEach(item => {
        item.addEventListener("click", () => {
            entratas.forEach(el => el.classList.remove("active")); // Remove from others
            item.classList.add("active"); // Add to clicked
        });
    });

    // Close forms and remove highlights when clicking outside
    document.addEventListener("click", (event) => {
        // Close "Add" form
        const clickedInsideAdd = addInner.contains(event.target) || addBtn.contains(event.target);
        if (!clickedInsideAdd && !addOuter.classList.contains("hidden")) {
            addOuter.classList.add("hidden");
        }

        // Close "Edit" form
        const clickedInsideEdit = editInner.contains(event.target) || event.target.closest(".edit-btn");
        if (!clickedInsideEdit && !editOuter.classList.contains("hidden")) {
            editOuter.classList.add("hidden");
        }

        // Remove .active from all .entrata if clicked outside
        const clickedInsideEntrata = [...entratas].some(el => el.contains(event.target));
        if (!clickedInsideEntrata) {
            entratas.forEach(el => el.classList.remove("active"));
        }
    });
});