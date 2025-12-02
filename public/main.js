let searchBar = document.getElementById("search-summaries");

if (searchBar) {
  searchBar.addEventListener("input", function () {
    let text = this.value.toLowerCase();
    let items = document.getElementsByClassName("feed");

    Array.from(items).forEach(function (item) {
      let content = item.innerText.toLowerCase();
      item.style.display = content.includes(text) ? "block" : "none";
    })
  })
}

let copyButton = document.getElementsByClassName("copy-summary");

Array.from(copyButton).forEach(function (btn) {
  btn.addEventListener("click", function () {
    let text = this.dataset.text;
    navigator.clipboard.writeText(text)
      .then(() => console.log("Copied:", text))
      .catch(err => console.log("Copy failed:", err))
  });
});

let stars = document.getElementsByClassName("rating-star");

Array.from(stars).forEach(function (star) {
  star.addEventListener("click", function () {
    let rating = this.dataset.value;
    let summaryDiv = this.closest(".feed");
    let summaryID = summaryDiv.dataset.id;
    let starGroup = summaryDiv.querySelectorAll(".rating-star")

    Array.from(starGroup).forEach(function (s) {
      if (Number(s.dataset.value) <= Number(rating)) {
        s.classList.add("active");
      } else {
        s.classList.remove("active");
      }
    });

    fetch("/rate-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summaryID, rating})
    })
    .then(res => res.json())
    .then(data => console.log("Rating saved:", data))
    .catch(err => console.log("Rating failed:", err));
  });
});

let deleteButton = document.getElementsByClassName("delete-summary");

Array.from(deleteButton).forEach(function(btn) {
  btn.addEventListener("click", function() {
    let summaryDiv = this.closest(".feed");
    let summaryID = summaryDiv.dataset.id;

    fetch("/delete-summary", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summaryID })
    })
    .then(res => res.json())
    .then(data => {
      console.log("Summary deleted:", data);
      summaryDiv.remove();
    })
    .catch(err => console.log("Delete failed:", err));
  });
});
