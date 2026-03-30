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

let latestSummaryBlock = document.querySelector(".result");

if (latestSummaryBlock) {
  let summaryText = latestSummaryBlock.querySelector("p").innerText;

  fetch("/recommended-podcasts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary: summaryText })
  })

  .then(res => res.json())
  .then (data => {
    if (data.success) {
      insertRecommendations(data.results);
    }
  })
  .catch(err => console.log("Recommendation fetch error", err));
}

function insertRecommendations(recommendations) {
  let container = document.querySelector(".related-podcasts .podcast-grid");
  
  if(!container) return;

  container.innerHTML = "";

  recommendations.forEach(ep => {
    let card = document.createElement("div");
    card.classList.add("podcast-card");

    card.innerHTML = `
    <img src="${ep.image || ep.thumbnail || ''}" style="width:100%; border-radius:6px; margin-bottom:10px
    <h4>${ep.podcast_title_original}</h4>
    <p> ${ep.description_original.substring(0, 120)}...</p>
    <a href="${ep.listennotes_url}" target="_blank">Listen to Episode</a>;
    <br>
    <a href="${ep.podcast?.listennotes_url}" target="_blank">View Podcast</a>`;

    container.appendChild(card)
  })
}

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
