document.addEventListener("DOMContentLoaded", () => {
    // Detecta qual seção está ativa
    const sectionEl = document.querySelector("#home") || document.querySelector("#family") || document.querySelector("#bills");
    if (!sectionEl) return;

    const sectionId = sectionEl.id;
    const selector = `#${sectionId}`;

    // Preenche a data atual no campo de data (se existir e estiver vazio)
    const dateInput = document.querySelector(`${selector} input[type="date"]`);
    if (dateInput && !dateInput.value) {
        const today = new Date();
        dateInput.value = today.toISOString().split("T")[0];
    }

    // Abrir/fechar formulário de adição
    const addBtn = sectionEl.querySelector(".new-spese");
    const addOuter = sectionEl.querySelector(".container-plus-btn");
    const addInner = addOuter?.querySelector(".container");

    addBtn?.addEventListener("click", () => {
        addOuter.classList.toggle("hidden");
    });

    // Abrir formulário de edição
    const editOuter = document.querySelector(`${selector} .container-edit-btn`);
    const editInner = editOuter?.querySelector(".container");

    // Seleciona o formulário correto de acordo com a seção
    const editForm =
        sectionId === "bills"
            ? document.getElementById("edit-bill-form")
            : sectionId === "family"
                ? document.getElementById("edit-family-form")
                : document.getElementById("edit-weekly-form");

    document.querySelectorAll(`${selector} .edit-btn`).forEach(button => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();

            const id = button.dataset.id;
            const name = button.dataset.name;
            const value = button.dataset.value;

            if (!editForm) return;

            // Define a rota de edição
            editForm.action =
                sectionId === "bills"
                    ? `/edit-bill/${id}`
                    : sectionId === "family"
                        ? `/edit-family/${id}`
                        : `/edit-weekly_expenses/${id}`;

            // Preenche os campos do formulário
            document.getElementById("edit-name").value = name;
            document.getElementById("edit-value").value = value;

            if (sectionId === "bills") {
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

    // Confirmação antes de deletar
    document.querySelectorAll(`${selector} .delete-form`).forEach(form => {
        form.addEventListener("submit", (event) => {
            const msg =
                sectionId === "bills"
                    ? "Sei sicuro di voler eliminare questa spesa?"
                    : "Sei sicuro di voler eliminare questa entrata?";
            if (!confirm(msg)) {
                event.preventDefault();
            }
        });
    });

    // Destacar entrada clicada
    const entratas = document.querySelectorAll(`${selector} .entrata`);
    entratas.forEach(item => {
        item.addEventListener("click", () => {
            entratas.forEach(el => el.classList.remove("active"));
            item.classList.add("active");
        });
    });

    // Fechar formulários e remover destaque ao clicar fora
    document.addEventListener("click", (event) => {
        // Fechar formulário de adição
        if (addOuter && addInner && addBtn) {
            const clickedInsideAdd = addInner.contains(event.target) || addBtn.contains(event.target);
            if (!clickedInsideAdd && !addOuter.classList.contains("hidden")) {
                addOuter.classList.add("hidden");
            }
        }

        // Fechar formulário de edição
        if (editOuter && editInner) {
            const clickedInsideEdit = editInner.contains(event.target) || event.target.closest(".edit-btn");
            if (!clickedInsideEdit && !editOuter.classList.contains("hidden")) {
                editOuter.classList.add("hidden");
            }
        }

        // Remover destaque das entradas
        if (entratas?.length) {
            const clickedInsideEntrata = [...entratas].some(el => el.contains(event.target));
            if (!clickedInsideEntrata) {
                entratas.forEach(el => el.classList.remove("active"));
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

// Fclosing menu when clicking outside
document.addEventListener("click", function (event) {
    const dropdown = document.querySelector(".dropdown-menu");
    const btn = document.querySelector(".settings-btn");
    const form = document.querySelector(".logout-form");

    // verify if the click was outside the dropdown and button
    if (!dropdown.contains(event.target)) {
        btn.classList.remove("active");
        form.classList.add("hidden");
    }
});


//   load new page
window.addEventListener("beforeunload", () => {
    document.getElementById("loader").classList.remove("hidden");
});
