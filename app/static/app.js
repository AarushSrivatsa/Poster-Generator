const $ = (selector) => document.querySelector(selector);
let vehicles = [];
let templates = [];
let current = null;
let photos = [];

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.remove("hidden");
  window.setTimeout(() => element.classList.add("hidden"), 2400);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || "Request failed");
  }
  return response.json();
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function load() {
  [vehicles, templates] = await Promise.all([
    api("/api/vehicles"),
    api("/api/templates"),
  ]);
  renderVehicles();
  renderTemplates();
  if (vehicles.length) selectVehicle(vehicles[0].vehicle.id);
  else newVehicle();
}

function renderVehicles() {
  $("#vehicleCount").textContent = vehicles.length;
  $("#vehicleList").innerHTML = vehicles.map((item) =>
    '<button class="vehicle-item ' + (current && current.id === item.vehicle.id ? "selected" : "") +
    '" data-id="' + item.vehicle.id + '"><b class="block">' +
    esc(item.vehicle.make) + " " + esc(item.vehicle.model) +
    '</b><small class="text-slate-500">' + esc(item.vehicle.year) + " · " +
    esc(item.vehicle.variant) + "</small></button>"
  ).join("") || '<p class="text-sm text-slate-500">No vehicles saved yet.</p>';

  document.querySelectorAll(".vehicle-item").forEach((button) => {
    button.onclick = () => selectVehicle(Number(button.dataset.id));
  });
}

function selectVehicle(id) {
  const item = vehicles.find((entry) => entry.vehicle.id === id);
  if (!item) return;
  current = item.vehicle;
  photos = item.photos;
  const form = $("#vehicleForm");
  Object.keys(current).forEach((key) => {
    if (form.elements[key]) form.elements[key].value = current[key] ?? "";
  });
  $("#deleteVehicle").classList.remove("hidden");
  renderVehicles();
  renderPhotos();
  refreshPreview();
}

function newVehicle() {
  current = null;
  photos = [];
  $("#vehicleForm").reset();
  $("#vehicleForm [name=id]").value = "";
  $("#deleteVehicle").classList.add("hidden");
  renderVehicles();
  renderPhotos();
}

$("#newVehicle").onclick = () => {
  newVehicle();
  switchTab("vehicle");
};

$("#saveVehicle").onclick = async () => {
  try {
    const data = formPayload($("#vehicleForm"));
    const id = data.id;
    delete data.id;
    const saved = await api(id ? "/api/vehicles/" + id : "/api/vehicles", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    await load();
    selectVehicle(saved.id);
    toast("Vehicle details saved");
  } catch (error) {
    toast(error.message);
  }
};

$("#deleteVehicle").onclick = async () => {
  if (!current || !confirm("Delete this vehicle and its uploaded photos?")) return;
  try {
    await api("/api/vehicles/" + current.id, { method: "DELETE" });
    current = null;
    await load();
    toast("Vehicle deleted");
  } catch (error) {
    toast(error.message);
  }
};

function switchTab(name) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.add("hidden"));
  $("#" + name + "Panel").classList.remove("hidden");
  document.querySelectorAll(".tab").forEach((tab) =>
    tab.classList.toggle("active", tab.dataset.tab === name)
  );
  if (name === "photos") renderPhotos();
  if (name === "poster") refreshPreview();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => switchTab(tab.dataset.tab);
});

const uploadZone = $("#uploadZone");
const photoInput = $("#photoInput");
uploadZone.onclick = () => photoInput.click();
uploadZone.ondragover = (event) => {
  event.preventDefault();
  uploadZone.classList.add("drag");
};
uploadZone.ondragleave = () => uploadZone.classList.remove("drag");
uploadZone.ondrop = (event) => {
  event.preventDefault();
  uploadZone.classList.remove("drag");
  upload(event.dataTransfer.files);
};
photoInput.onchange = () => upload(photoInput.files);

async function upload(files) {
  if (!current) {
    toast("Save a vehicle first");
    return;
  }
  const body = new FormData();
  Array.from(files).forEach((file) => body.append("files", file));
  try {
    await api("/api/vehicles/" + current.id + "/photos", { method: "POST", body });
    await reloadCurrent();
    toast("Photos uploaded to Supabase Storage");
  } catch (error) {
    toast(error.message);
  }
  photoInput.value = "";
}

async function reloadCurrent() {
  const all = await api("/api/vehicles");
  vehicles = all;
  const item = all.find((entry) => entry.vehicle.id === current.id);
  if (item) {
    current = item.vehicle;
    photos = item.photos;
  }
  renderVehicles();
  renderPhotos();
  refreshPreview();
}

function activeTemplate() {
  const id = Number($("#photoTemplateSelect").value || $("#templateSelect").value);
  return templates.find((template) => template.id === id) || templates[0];
}

function titleForSlot(key) {
  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function dynamicSlots() {
  const markup = activeTemplate() ? activeTemplate().html : "";
  const matches = markup.matchAll(/\{\{\s*slot\.([a-zA-Z0-9_-]{1,40})\s*\}\}/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1])));
}

function renderPhotos() {
  $("#photoLibrary").innerHTML = photos.map((photo) =>
    '<div class="group relative"><img class="photo-thumb w-full" draggable="true" data-photo="' +
    photo.id + '" src="' + esc(photo.url) + '" title="Drag onto a slot">' +
    '<button class="absolute right-1 top-1 rounded-md bg-black/80 px-2 py-1 text-xs" data-delete-photo="' +
    photo.id + '">×</button><p class="mt-1 truncate text-[10px] text-slate-400">' +
    esc(photo.label) + "</p></div>"
  ).join("") || '<p class="col-span-2 text-xs text-slate-500">Upload photos to start assigning them.</p>';

  const slots = dynamicSlots();
  $("#slotBoard").innerHTML = slots.length ? slots.map((key) => {
    const label = titleForSlot(key);
    const photo = photos.find((item) => item.slot === key);
    const preview = photo
      ? '<img src="' + esc(photo.url) + '" alt="">'
      : '<span class="text-center text-xs text-slate-500">Drop image here</span>';
    const options = photos.map((item) =>
      '<option value="' + item.id + '"' + (photo && photo.id === item.id ? " selected" : "") +
      ">" + esc(item.label) + "</option>"
    ).join("");

    return '<div class="slot-card" data-slot-card="' + esc(key) + '">' +
      '<div class="mb-2 flex justify-between gap-2"><b class="text-xs">' + esc(label) +
      '</b><span class="text-[10px] text-slate-500">' + esc(key) + "</span></div>" +
      '<div class="slot-drop" data-drop-slot="' + esc(key) + '">' + preview + "</div>" +
      '<select class="mt-2" data-select-slot="' + esc(key) +
      '"><option value="">Choose from library…</option>' + options + "</select>" +
      '<input data-caption="' + esc(key) + '" value="' +
      esc(photo ? photo.label : label) + '" aria-label="Caption for ' + esc(label) + '">' +
      '<button class="mt-2 text-xs text-rose-300" data-clear-slot="' + esc(key) +
      '">Clear slot</button></div>';
  }).join("") :
    '<div class="col-span-full rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">This template defines no image slots yet. Add any number of <code>{{slot.your_name}}</code> placeholders to its HTML, save it, and select it here.</div>';

  document.querySelectorAll("[data-photo]").forEach((element) => {
    element.ondragstart = (event) => event.dataTransfer.setData("photoId", element.dataset.photo);
  });

  document.querySelectorAll("[data-drop-slot]").forEach((element) => {
    element.ondragover = (event) => {
      event.preventDefault();
      element.classList.add("over");
    };
    element.ondragleave = () => element.classList.remove("over");
    element.ondrop = (event) => {
      event.preventDefault();
      element.classList.remove("over");
      assign(Number(event.dataTransfer.getData("photoId")), element.dataset.dropSlot);
    };
  });

  document.querySelectorAll("[data-select-slot]").forEach((element) => {
    element.onchange = () => assign(Number(element.value), element.dataset.selectSlot);
  });

  document.querySelectorAll("[data-caption]").forEach((element) => {
    element.onchange = async () => {
      const photo = photos.find((item) => item.slot === element.dataset.caption);
      if (!photo) return;
      try {
        await api("/api/photos/" + photo.id, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: element.value }),
        });
        await reloadCurrent();
      } catch (error) {
        toast(error.message);
      }
    };
  });

  document.querySelectorAll("[data-clear-slot]").forEach((element) => {
    element.onclick = async () => {
      const photo = photos.find((item) => item.slot === element.dataset.clearSlot);
      if (!photo) return;
      try {
        await api("/api/photos/" + photo.id, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot: "" }),
        });
        await reloadCurrent();
      } catch (error) {
        toast(error.message);
      }
    };
  });

  document.querySelectorAll("[data-delete-photo]").forEach((element) => {
    element.onclick = async () => {
      if (!confirm("Delete this photo?")) return;
      try {
        await api("/api/photos/" + element.dataset.deletePhoto, { method: "DELETE" });
        await reloadCurrent();
      } catch (error) {
        toast(error.message);
      }
    };
  });
}

async function assign(id, slot) {
  if (!id || !slot) return;
  try {
    // A stored photo occupies one slot at a time; replace the current occupant.
    for (const occupant of photos.filter((item) => item.slot === slot && item.id !== id)) {
      await api("/api/photos/" + occupant.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: "" }),
      });
    }
    await api("/api/photos/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot }),
    });
    await reloadCurrent();
    toast("Photo assigned to " + slot);
  } catch (error) {
    toast(error.message);
  }
}

function renderTemplates() {
  const options = templates.map((template) =>
    '<option value="' + template.id + '">' + esc(template.name) + "</option>"
  ).join("");
  $("#templateSelect").innerHTML = options;
  $("#photoTemplateSelect").innerHTML = options;
  $("#templateList").innerHTML = templates.map((template) =>
    '<div class="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3">' +
    '<div><b class="text-sm">' + esc(template.name) + '</b><p class="text-xs text-slate-500">' +
    esc(template.description) + "</p></div><button class=\"text-xs text-rose-300\" data-del-template=\"" +
    template.id + "\">Delete</button></div>"
  ).join("") || '<p class="text-sm text-slate-500">No custom templates yet.</p>';

  document.querySelectorAll("[data-del-template]").forEach((button) => {
    button.onclick = async () => {
      if (!confirm("Delete template?")) return;
      try {
        await api("/api/templates/" + button.dataset.delTemplate, { method: "DELETE" });
        templates = await api("/api/templates");
        renderTemplates();
        renderPhotos();
        refreshPreview();
      } catch (error) {
        toast(error.message);
      }
    };
  });
}

$("#templateForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    await api("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formPayload(event.target)),
    });
    templates = await api("/api/templates");
    renderTemplates();
    renderPhotos();
    event.target.reset();
    toast("Template saved");
  } catch (error) {
    toast(error.message);
  }
};

async function refreshPreview() {
  if (!current || !templates.length) return;
  const templateId = $("#templateSelect").value || templates[0].id;
  $("#posterFrame").src = "/api/vehicles/" + current.id + "/poster/" + templateId + "?v=" + Date.now();
}

$("#refreshPreview").onclick = refreshPreview;
$("#templateSelect").onchange = () => {
  $("#photoTemplateSelect").value = $("#templateSelect").value;
  renderPhotos();
  refreshPreview();
};
$("#photoTemplateSelect").onchange = () => {
  $("#templateSelect").value = $("#photoTemplateSelect").value;
  renderPhotos();
  refreshPreview();
};
$("#printPoster").onclick = () => $("#posterFrame").contentWindow.print();

load().catch((error) => toast(error.message));
