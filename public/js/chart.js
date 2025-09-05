document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.querySelector(".new-spese");
    const outerContainer = document.querySelector(".container-plus-btn");
    const innerContainer = document.querySelector(".container");

    toggleBtn.addEventListener("click", () => {
        outerContainer.classList.toggle("hidden");
    });

    document.addEventListener("click", (event) => {
        const clickedOutside = !innerContainer.contains(event.target) && !toggleBtn.contains(event.target);
        if (!outerContainer.classList.contains("hidden") && clickedOutside) {
            outerContainer.classList.add("hidden");
        }
    });
});

// today date for input date field - home
document.addEventListener("DOMContentLoaded", () => {
    const dateInput = document.querySelector("input[name='date_expense']");
    if (dateInput) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
    }
});
