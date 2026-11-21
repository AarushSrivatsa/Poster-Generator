const $ = selector => document.querySelector(selector);
let cars=[], makes=[], templates=[], posters=[];
let editingCarId=null, editingTemplateId=null, activePoster=null, activeCar=null, activeTemplate=null;
let selectedCarId=null, selectedTemplateId=null, selectedImageId=null, posterSaveTimer=null, posterSavePromise=null, toastTimer=null;
const FUEL_TYPES=["Petrol","Diesel","CNG","Petrol + CNG","LPG","Petrol + LPG","Electric","Hybrid","Plug-in Hybrid","Hydrogen"];
const TRANSMISSION_TYPES=["Manual","AMT","Torque Converter Automatic","CVT","DCT / DSG","iMT","e-CVT","Single-speed EV"];
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const jsonOptions=payload=>({headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
async function api(url,options={}){const r=await fetch(url,options);if(!r.ok){const data=await r.json().catch(()=>({detail:r.statusText}));throw Error(data.detail||"Request failed")}if(r.status===204)return{};return r.json()}
function toast(message){const e=$("#toast");e.textContent=message;e.classList.remove("hidden");clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.add("hidden"),3200)}
function fail(error){console.error(error);toast(error.message||"Something went wrong")}
function switchTab(name){document.querySelectorAll(".panel").forEach(p=>p.classList.add("hidden"));$("#"+name+"Panel").classList.remove("hidden");document.querySelectorAll(".nav-tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));if(name==="posters")renderPosterChoices();if(name==="cars")renderCars();if(name==="makes")renderMakes();if(name==="templates")renderTemplates()}
document.querySelectorAll(".nav-tab").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
function yearOptions(start=1980,end=new Date().getFullYear()+1){let s="";for(let y=end;y>=start;y--)s+='<option value="'+y+'">'+y+'</option>';return s}
function fillSelect(el,values,placeholder){el.innerHTML='<option value="">'+esc(placeholder)+'</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("")}
function monthFromIso(v){return v?String(v).slice(0,7):""}
function yearFromIso(v){return v?String(v).slice(0,4):""}
async function loadAll(){try{const data=await Promise.all([api("/api/makes"),api("/api/cars"),api("/api/templates"),api("/api/posters")]);makes=data[0];cars=data[1];templates=data[2];posters=data[3];selectedCarId=cars[0]?.id??null;selectedTemplateId=templates[0]?.id??null;renderMakes();renderCars();renderTemplates();renderPosterChoices();renderPosters();refreshMakeSelect();resetCarForm()}catch(e){fail(e)}}
function initControls(){fillSelect($("#fuelSelect"),FUEL_TYPES,"Choose fuel type");fillSelect($("#transmissionSelect"),TRANSMISSION_TYPES,"Choose transmission");$("#yearSelect").innerHTML='<option value="">Choose year</option>'+yearOptions();$("#fitnessDate").innerHTML='<option value="">Choose year</option>'+yearOptions();$("#templateForm").elements.id.value="";showDetectedSchema()}
$("#insuranceMode").onchange=()=>$("#insuranceDateWrap").classList.toggle("hidden",$("#insuranceMode").value!=="date");
$("#fitnessMode").onchange=()=>$("#fitnessDateWrap").classList.toggle("hidden",$("#fitnessMode").value!=="date");

/* MAKE CRUD */
function refreshMakeSelect(selected){$("#carMakeSelect").innerHTML='<option value="">Choose make</option>'+makes.map(m=>'<option value="'+m.id+'">'+esc(m.name)+'</option>').join("");$("#carMakeSelect").value=selected?String(selected):""}
function renderMakes(){
  $("#makeCount").textContent=makes.length+" makes";
  $("#makeList").innerHTML=makes.map(m=>
    '<article class="make-card">'+
    (m.icon_url?'<img src="'+esc(m.icon_url)+'" alt="">':'<div class="make-placeholder">'+esc(m.name.slice(0,1))+'</div>')+
    '<div><b>'+esc(m.name)+'</b><button type="button" data-make-icon="'+m.id+'">'+(m.icon_url?"Replace logo":"Upload logo")+'</button>'+
    '<button type="button" data-rename-make="'+m.id+'">Rename</button>'+
    '<button type="button" data-delete-make="'+m.id+'">Delete</button></div>'+
    '<input type="file" accept="image/*" hidden data-make-file="'+m.id+'"></article>'
  ).join("")||'<div class="empty-card">No makes yet. Add the manufacturers you work with.</div>';
  refreshMakeSelect(editingCarId?cars.find(c=>c.id===editingCarId)?.make_id:"");
  document.querySelectorAll("[data-make-icon]").forEach(b=>b.onclick=()=>document.querySelector('[data-make-file="'+b.dataset.makeIcon+'"]').click());
  document.querySelectorAll("[data-make-file]").forEach(input=>input.onchange=async()=>{
    if(!input.files.length)return;
    const f=new FormData();f.append("file",input.files[0]);
    try{
      const updated=await api("/api/makes/"+input.dataset.makeFile+"/icon",{method:"POST",body:f});
      makes=makes.map(m=>m.id===updated.id?updated:m);renderMakes();toast("Make logo uploaded.");
    }catch(e){fail(e)}
    input.value="";
  });
  document.querySelectorAll("[data-rename-make]").forEach(b=>b.onclick=async()=>{
    const make=makes.find(m=>m.id===Number(b.dataset.renameMake));
    const name=prompt("Manufacturer name",make?.name||"");
    if(!name||!name.trim())return;
    try{
      const updated=await api("/api/makes/"+make.id,{method:"PUT",...jsonOptions({name:name.trim()})});
      makes=makes.map(m=>m.id===updated.id?updated:m);
      cars=await api("/api/cars");renderMakes();renderCars();renderPosterChoices();renderPosters();
      toast("Make renamed.");
    }catch(e){fail(e)}
  });
  document.querySelectorAll("[data-delete-make]").forEach(b=>b.onclick=async()=>{
    const make=makes.find(m=>m.id===Number(b.dataset.deleteMake));
    if(!confirm("Delete make "+make?.name+"?"))return;
    try{
      await api("/api/makes/"+make.id,{method:"DELETE"});
      makes=makes.filter(m=>m.id!==make.id);renderMakes();toast("Make deleted.");
    }catch(e){fail(e)}
  });
}
$("#makeForm").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;try{const make=await api("/api/makes",{method:"POST",...jsonOptions({name:form.elements.name.value.trim()})});makes.push(make);if(form.elements.icon.files[0]){const f=new FormData();f.append("file",form.elements.icon.files[0]);const updated=await api("/api/makes/"+make.id+"/icon",{method:"POST",body:f});makes=makes.map(m=>m.id===updated.id?updated:m)}form.reset();renderMakes();toast("Make added.")}catch(error){fail(error)}};

/* CAR CRUD */
function resetCarForm(){editingCarId=null;$("#carForm").reset();$("#carFormTitle").textContent="Add a car";$("#deleteCar").classList.add("hidden");$("#insuranceMode").value="lapsed";$("#fitnessMode").value="lapsed";$("#insuranceDateWrap").classList.add("hidden");$("#fitnessDateWrap").classList.add("hidden");refreshMakeSelect();$("#fuelSelect").value="";$("#transmissionSelect").value="";$("#yearSelect").value=""}
function fillCarForm(car){editingCarId=car.id;const f=$("#carForm");f.elements.make_id.value=String(car.make_id);f.elements.model.value=car.model||"";f.elements.variant.value=car.variant||"";f.elements.registration_no.value=car.registration_no||"";f.elements.fuel_type.value=car.fuel_type;f.elements.year.value=String(car.year);f.elements.transmission.value=car.transmission;f.elements.odometer_km.value=car.odometer_km??"";f.elements.owner_count.value=car.owner_count??"";$("#insuranceMode").value=car.insurance_validity?"date":"lapsed";$("#insuranceDateWrap").classList.toggle("hidden",!car.insurance_validity);$("#insuranceDate").value=monthFromIso(car.insurance_validity);$("#fitnessMode").value=car.fitness_validity?"date":"lapsed";$("#fitnessDateWrap").classList.toggle("hidden",!car.fitness_validity);$("#fitnessDate").value=yearFromIso(car.fitness_validity);$("#carFormTitle").textContent="Edit "+car.make.name+" "+car.model;$("#deleteCar").classList.remove("hidden");refreshMakeSelect(car.make_id)}
function renderCars(){$("#carCount").textContent=cars.length+" cars";$("#carList").innerHTML=cars.map(c=>'<button type="button" class="record-row '+(editingCarId===c.id?"selected":"")+'" data-edit-car="'+c.id+'"><span class="record-main"><b>'+esc(c.make?.name)+" "+esc(c.model)+'</b><small>'+esc(c.year)+" · "+esc(c.registration_no)+'</small></span><span class="record-actions">Edit →</span></button>').join("")||'<div class="empty-card">No cars saved yet.</div>';document.querySelectorAll("[data-edit-car]").forEach(b=>b.onclick=()=>{const car=cars.find(c=>c.id===Number(b.dataset.editCar));if(car)fillCarForm(car);renderCars()})}
$("#newCar").onclick=()=>{resetCarForm();switchTab("cars");if(!makes.length)toast("Add a make first in the Makes tab.")};
$("#cancelCarEdit").onclick=resetCarForm;
$("#saveCar").onclick=async()=>{const f=$("#carForm");const payload={make_id:f.elements.make_id.value,model:f.elements.model.value.trim(),variant:f.elements.variant.value.trim(),registration_no:f.elements.registration_no.value.trim(),fuel_type:f.elements.fuel_type.value,year:f.elements.year.value,transmission:f.elements.transmission.value,odometer_km:f.elements.odometer_km.value||null,owner_count:f.elements.owner_count.value||null,insurance_validity:$("#insuranceMode").value==="lapsed"?"Lapsed":$("#insuranceDate").value,fitness_validity:$("#fitnessMode").value==="lapsed"?"Lapsed":$("#fitnessDate").value};if(!payload.insurance_validity)return toast("Choose an insurance expiry month or mark it lapsed.");if(!payload.fitness_validity)return toast("Choose a fitness expiry year or mark it lapsed.");try{const result=await api(editingCarId?"/api/cars/"+editingCarId:"/api/cars",{method:editingCarId?"PUT":"POST",...jsonOptions(payload)});const car=await api("/api/cars/"+result.id);cars=cars.filter(c=>c.id!==car.id).concat(car);selectedCarId=car.id;resetCarForm();renderCars();renderPosterChoices();renderPosters();toast("Car saved.")}catch(e){fail(e)}};
$("#deleteCar").onclick=async()=>{if(!editingCarId||!confirm("Delete this car, its photos and its saved posters?"))return;try{await api("/api/cars/"+editingCarId,{method:"DELETE"});cars=cars.filter(c=>c.id!==editingCarId);posters=posters.filter(p=>p.car_id!==editingCarId);if(activePoster?.car_id===editingCarId)closePosterEditor();selectedCarId=cars[0]?.id??null;resetCarForm();renderCars();renderPosterChoices();renderPosters();toast("Car and images deleted.")}catch(e){fail(e)}};

/* TEMPLATE CRUD */
function detectedTokens(markup){return [...new Set([...String(markup||"").matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]{0,79})\s*\}\}/g)].map(m=>m[1]))]}
function showDetectedSchema(){const keys=detectedTokens($("#templateHtml").value);$("#templatePlaceholderCount").textContent=keys.length+" placeholders";$("#templateDetected").innerHTML=keys.length?keys.map(k=>'<span class="schema-chip">'+esc(k)+'</span>').join(""):'<span class="muted">No placeholders detected yet.</span>'}
$("#templateHtml").oninput=showDetectedSchema;
function resetTemplateForm(){editingTemplateId=null;$("#templateForm").reset();$("#templateForm").elements.id.value="";$("#templateFormTitle").textContent="Add a template";showDetectedSchema()}
function editTemplate(id){const t=templates.find(x=>x.id===id);if(!t)return;editingTemplateId=id;const f=$("#templateForm");f.elements.id.value=t.id;f.elements.name.value=t.name;f.elements.description.value=t.description||"";f.elements.html_content.value=t.html_content;$("#templateFormTitle").textContent=t.name;showDetectedSchema();switchTab("templates");f.scrollIntoView({behavior:"smooth",block:"start"})}
function renderTemplates() {
  $("#templateCount").textContent = templates.length + " templates";
  const rows = templates.map(t => {
    let actions = '<button type="button" data-edit-template="' + t.id + '">Edit</button>' +
      '<button type="button" data-copy-template="' + t.id + '">Copy</button>';
    if (!t.is_builtin) actions += '<button type="button" class="delete-link" data-delete-template="' + t.id + '">Delete</button>';
    return '<article class="record-row">' +
      '<span class="record-main"><b>' + esc(t.name) + (t.is_builtin ? " · Built-in" : "") +
      '</b><small>' + esc(t.description || "Custom template") + " · " +
      ((t.placeholder_schema?.images || []).length) + " images · " +
      ((t.placeholder_schema?.text || []).length) + " text fields</small></span>" +
      '<span class="record-actions">' + actions + '</span></article>';
  }).join("");
  $("#templateList").innerHTML = rows || '<div class="empty-card">No templates yet.</div>';
  document.querySelectorAll("[data-edit-template]").forEach(b => b.onclick = () => editTemplate(Number(b.dataset.editTemplate)));
  document.querySelectorAll("[data-copy-template]").forEach(b => b.onclick = () => {
    const t = templates.find(x => x.id === Number(b.dataset.copyTemplate));
    if (!t) return;
    resetTemplateForm();
    $("#templateForm").elements.name.value = t.name + " Copy";
    $("#templateForm").elements.description.value = t.description || "";
    $("#templateForm").elements.html_content.value = t.html_content;
    showDetectedSchema();
    switchTab("templates");
  });
  document.querySelectorAll("[data-delete-template]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this template?")) return;
    try {
      await api("/api/templates/" + b.dataset.deleteTemplate, {method:"DELETE"});
      templates = await api("/api/templates");
      posters = await api("/api/posters");
      renderTemplates(); renderPosterChoices(); renderPosters();
      toast("Template deleted.");
    } catch (e) { fail(e); }
  });
}
$("#newTemplate").onclick=()=>{resetTemplateForm();switchTab("templates")};
$("#cancelTemplateEdit").onclick=resetTemplateForm;
$("#templateForm").onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;const payload={name:f.elements.name.value.trim(),description:f.elements.description.value.trim(),html_content:f.elements.html_content.value};try{await api(editingTemplateId?"/api/templates/"+editingTemplateId:"/api/templates",{method:editingTemplateId?"PUT":"POST",...jsonOptions(payload)});templates=await api("/api/templates");resetTemplateForm();renderTemplates();renderPosterChoices();toast("Template saved. Placeholders detected.")}catch(error){fail(error)}};

/* POSTER CRUD AND CREATION */
function renderPosterChoices(){$("#posterCarChoices").innerHTML=cars.map(c=>'<button type="button" class="choice-pill '+(selectedCarId===c.id?"selected":"")+'" data-choose-car="'+c.id+'">'+esc(c.make?.name)+" "+esc(c.model)+" · "+esc(c.year)+'</button>').join("")||'<span class="muted">Add a car in Cars first.</span>';$("#posterTemplateChoices").innerHTML=templates.map(t=>'<button type="button" class="template-pill '+(selectedTemplateId===t.id?"selected":"")+'" data-choose-template="'+t.id+'">'+esc(t.name)+'</button>').join("")||'<span class="muted">Add a template first.</span>';document.querySelectorAll("[data-choose-car]").forEach(b=>b.onclick=()=>{selectedCarId=Number(b.dataset.chooseCar);renderPosterChoices()});document.querySelectorAll("[data-choose-template]").forEach(b=>b.onclick=()=>{selectedTemplateId=Number(b.dataset.chooseTemplate);renderPosterChoices()});$("#createPoster").disabled=!(selectedCarId&&selectedTemplateId)}
$("#startNewPoster").onclick=()=>document.querySelector(".create-strip").scrollIntoView({behavior:"smooth",block:"center"});
$("#createPoster").onclick=async()=>{if(!selectedCarId||!selectedTemplateId)return toast("Choose a car and template.");try{const p=await api("/api/posters",{method:"POST",...jsonOptions({car_id:selectedCarId,template_id:selectedTemplateId})});posters.unshift(p);renderPosters();await openPoster(p.id);toast("Poster created. Edit text and drag photos into place.")}catch(e){fail(e)}};
function renderPosters(){$("#posterCount").textContent=posters.length+" posters";$("#posterList").innerHTML=posters.map(p=>{const c=cars.find(x=>x.id===p.car_id),t=templates.find(x=>x.id===p.template_id);return'<article class="poster-card"><div class="poster-card-main"><b>'+esc(p.name||t?.name||"Poster")+'</b><small>'+esc(c?.make?.name||"")+" "+esc(c?.model||"Car")+" · "+esc(t?.name||"Template")+'</small></div><div class="poster-card-actions"><button type="button" data-open-poster="'+p.id+'">Open</button><button type="button" class="delete-link" data-delete-poster="'+p.id+'">Delete</button></div></article>'}).join("")||'<div class="empty-card">No posters saved. Choose a car and template above to create one.</div>';document.querySelectorAll("[data-open-poster]").forEach(b=>b.onclick=()=>openPoster(Number(b.dataset.openPoster)).catch(fail));document.querySelectorAll("[data-delete-poster]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this poster?"))return;try{const id=Number(b.dataset.deletePoster);await api("/api/posters/"+id,{method:"DELETE"});posters=posters.filter(p=>p.id!==id);if(activePoster?.id===id)closePosterEditor();renderPosters();toast("Poster deleted.")}catch(e){fail(e)}})}
async function openPoster(id){if(activePoster&&activePoster.id!==id){clearTimeout(posterSaveTimer);await savePosterNow()}const p=await api("/api/posters/"+id),c=await api("/api/cars/"+p.car_id),t=templates.find(x=>x.id===p.template_id);if(!t)throw Error("The template for this poster no longer exists.");activePoster=p;activeCar=c;activeTemplate=t;selectedImageId=null;$("#posterEditor").classList.remove("hidden");$("#activePosterTitle").textContent=p.name||t.name;$("#activePosterSubtitle").textContent=c.make.name+" "+c.model+" · "+t.name;$("#posterName").value=p.name||t.name;renderPosterTextFields();renderImageLibrary();renderImageSlots();refreshPosterPreview();setSaveStatus("saved");switchTab("posters");$("#posterEditor").scrollIntoView({behavior:"smooth",block:"start"})}
function closePosterEditor(){clearTimeout(posterSaveTimer);activePoster=null;activeCar=null;activeTemplate=null;$("#posterEditor").classList.add("hidden");$("#canvasEmpty").classList.remove("hidden");$("#posterFrame").classList.add("hidden")}
function setSaveStatus(state){const e=$("#saveStatus");e.classList.remove("saving","error");if(state==="saving"){e.classList.add("saving");e.innerHTML="<i></i> Saving…"}else if(state==="error"){e.classList.add("error");e.innerHTML="<i></i> Save failed"}else e.innerHTML="<i></i> All changes saved"}
function renderPosterTextFields(){const fields=activeTemplate?.placeholder_schema?.text||[],values=activePoster.text_values||{};$("#posterTextFields").innerHTML=fields.map(f=>{const value=values[f.key]??f.default??"",label=f.label||f.key;return'<label class="poster-text-field"><span>'+esc(label)+(f.required?' <small>Required</small>':"")+'</span>'+(f.multiline?'<textarea rows="3" data-text-key="'+esc(f.key)+'" placeholder="Write '+esc(label.toLowerCase())+'…">'+esc(value)+'</textarea>':'<input data-text-key="'+esc(f.key)+'" value="'+esc(value)+'" placeholder="Write '+esc(label.toLowerCase())+'…">')+'</label>'}).join("")||'<div class="empty-card">This template has no editable text. Add text.headline or text.price to its HTML.</div>';document.querySelectorAll("[data-text-key]").forEach(input=>input.oninput=()=>{activePoster.text_values=activePoster.text_values||{};activePoster.text_values[input.dataset.textKey]=input.value;schedulePosterSave()})}
$("#posterName").oninput=()=>{if(!activePoster)return;activePoster.name=$("#posterName").value;$("#activePosterTitle").textContent=activePoster.name||activeTemplate.name;schedulePosterSave()};
function schedulePosterSave(){if(!activePoster)return;setSaveStatus("saving");clearTimeout(posterSaveTimer);posterSaveTimer=setTimeout(()=>savePosterNow().catch(fail),250)}
async function savePosterNow(){if(!activePoster)return;clearTimeout(posterSaveTimer);if(posterSavePromise){await posterSavePromise;if(activePoster)return savePosterNow();return}const id=activePoster.id,snapshot={name:activePoster.name||"",text_values:{...(activePoster.text_values||{})},image_assignments:{...(activePoster.image_assignments||{})}};setSaveStatus("saving");posterSavePromise=api("/api/posters/"+id,{method:"PUT",...jsonOptions(snapshot)});try{const updated=await posterSavePromise;if(activePoster?.id!==id)return;const live={name:activePoster.name||"",text_values:activePoster.text_values||{},image_assignments:activePoster.image_assignments||{}};const changed=JSON.stringify(live)!==JSON.stringify(snapshot);activePoster.updated_at=updated.updated_at;posters=posters.map(p=>p.id===id?{...p,name:snapshot.name,updated_at:updated.updated_at}:p);renderPosters();if(changed){posterSavePromise=null;return savePosterNow()}setSaveStatus("saved");refreshPosterPreview()}catch(error){setSaveStatus("error");throw error}finally{posterSavePromise=null}}
function refreshPosterPreview(){if(!activePoster)return;$("#canvasEmpty").classList.add("hidden");$("#posterFrame").classList.remove("hidden");$("#posterFrame").src="/api/posters/"+activePoster.id+"/render?v="+Date.now()}
$("#refreshPoster").onclick=refreshPosterPreview;
$("#printPoster").onclick=()=>{if(!activePoster)return toast("Open a poster first.");$("#posterFrame").contentWindow?.postMessage({type:"POSTER_STUDIO_PRINT"},"*")};
$("#deletePoster").onclick=async()=>{if(!activePoster||!confirm("Delete this poster?"))return;try{const id=activePoster.id;await api("/api/posters/"+id,{method:"DELETE"});posters=posters.filter(p=>p.id!==id);closePosterEditor();renderPosters();toast("Poster deleted.")}catch(e){fail(e)}};
$("#duplicatePoster").onclick=async()=>{if(!activePoster)return;try{await savePosterNow();const p=await api("/api/posters",{method:"POST",...jsonOptions({car_id:activePoster.car_id,template_id:activePoster.template_id,name:(activePoster.name||activeTemplate.name)+" Copy"})});const updated=await api("/api/posters/"+p.id,{method:"PUT",...jsonOptions({name:p.name,text_values:activePoster.text_values||{},image_assignments:activePoster.image_assignments||{}})});posters.unshift(updated);renderPosters();await openPoster(updated.id);toast("Poster duplicated.")}catch(e){fail(e)}};

/* IMAGE LIBRARY */
function renderImageLibrary(){if(!activeCar)return;const images=activeCar.images||[];$("#imageCount").textContent=images.length+" images";$("#imageLibrary").innerHTML=images.map(im=>'<article class="image-card '+(selectedImageId===im.id?"selected":"")+'" data-image-card="'+im.id+'" draggable="true"><img src="'+esc(im.image_url)+'" alt="'+esc(im.image_type)+'"><input aria-label="Image type" data-image-type="'+im.id+'" value="'+esc(im.image_type)+'" title="Edit image type"><button type="button" data-delete-image="'+im.id+'">Remove image ×</button></article>').join("")||'<div class="empty-card">No photos yet. Upload car photos above.</div>';document.querySelectorAll("[data-image-card]").forEach(card=>{card.onclick=e=>{if(e.target.closest("[data-image-type]")||e.target.closest("[data-delete-image]"))return;selectedImageId=Number(card.dataset.imageCard);renderImageLibrary();renderImageSlots()};card.ondragstart=e=>{e.dataTransfer.effectAllowed="copy";e.dataTransfer.setData("carImageId",card.dataset.imageCard)}});document.querySelectorAll("[data-image-type]").forEach(input=>input.onchange=async()=>{try{await api("/api/images/"+input.dataset.imageType,{method:"PATCH",...jsonOptions({image_type:input.value})});const im=activeCar.images.find(x=>x.id===Number(input.dataset.imageType));if(im)im.image_type=input.value;toast("Image type saved.")}catch(e){fail(e)}});document.querySelectorAll("[data-delete-image]").forEach(button=>button.onclick=async e=>{e.stopPropagation();if(!confirm("Delete this uploaded image?"))return;try{const id=Number(button.dataset.deleteImage);activePoster.image_assignments=Object.fromEntries(Object.entries(activePoster.image_assignments||{}).filter(([,v])=>Number(v)!==id));await savePosterNow();await api("/api/images/"+id,{method:"DELETE"});activeCar.images=activeCar.images.filter(im=>im.id!==id);selectedImageId=null;renderImageLibrary();renderImageSlots();refreshPosterPreview();toast("Image deleted.")}catch(err){fail(err)}})}
function renderImageSlots(){if(!activePoster||!activeCar)return;const slots=activeTemplate?.placeholder_schema?.images||[],assignments=activePoster.image_assignments||{},images=activeCar.images||[];$("#imageSlots").innerHTML=slots.map(slot=>{const id=assignments[slot.key],im=images.find(x=>x.id===Number(id));return'<article class="image-slot '+(selectedImageId?"selected":"")+'" data-image-slot="'+esc(slot.key)+'"><div class="image-slot-head"><b>'+esc(slot.label||slot.key)+'</b><span>'+(im?"Assigned":"Empty")+'</span></div><div class="image-slot-preview">'+(im?'<img src="'+esc(im.image_url)+'" alt="">':"Drop a photo here")+'</div><div class="image-slot-tools"><small>'+esc(slot.key)+'</small>'+(im?'<button type="button" data-clear-slot="'+esc(slot.key)+'">Remove</button>':'<small>Tap or drop</small>')+'</div></article>'}).join("")||'<div class="empty-card">No image placeholders. Add image.hero or image.detail to this template.</div>';document.querySelectorAll("[data-image-slot]").forEach(slot=>{slot.ondragover=e=>{e.preventDefault();slot.classList.add("over")};slot.ondragleave=()=>slot.classList.remove("over");slot.ondrop=e=>{e.preventDefault();slot.classList.remove("over");const id=e.dataTransfer.getData("carImageId");if(id)assignImage(Number(id),slot.dataset.imageSlot);else if(e.dataTransfer.files?.length)uploadImages(e.dataTransfer.files,slot.dataset.imageSlot)};slot.onclick=e=>{if(e.target.closest("[data-clear-slot]"))return;if(selectedImageId)assignImage(selectedImageId,slot.dataset.imageSlot)}});document.querySelectorAll("[data-clear-slot]").forEach(b=>b.onclick=async e=>{e.stopPropagation();delete activePoster.image_assignments[b.dataset.clearSlot];try{await savePosterNow();renderImageSlots();refreshPosterPreview()}catch(err){fail(err)}})}
async function assignImage(imageId,key){if(!activePoster||!(activeCar.images||[]).some(im=>im.id===imageId))return;activePoster.image_assignments={...(activePoster.image_assignments||{}),[key]:imageId};try{await savePosterNow();selectedImageId=null;renderImageLibrary();renderImageSlots();refreshPosterPreview()}catch(e){fail(e)}}
const uploadZone=$("#imageUploadZone"),imageInput=$("#imageInput");
uploadZone.ondragover=e=>{e.preventDefault();uploadZone.classList.add("drag")};uploadZone.ondragleave=()=>uploadZone.classList.remove("drag");uploadZone.ondrop=e=>{e.preventDefault();uploadZone.classList.remove("drag");uploadImages(e.dataTransfer.files).catch(fail)};
imageInput.onchange=()=>uploadImages(imageInput.files).catch(fail);
async function uploadImages(files,slotKey=""){if(!activePoster||!activeCar||!files?.length)return;const form=new FormData();[...files].forEach(file=>form.append("files",file));const added=await api("/api/cars/"+activeCar.id+"/images",{method:"POST",body:form});activeCar=await api("/api/cars/"+activeCar.id);cars=cars.map(c=>c.id===activeCar.id?activeCar:c);if(slotKey&&added.length){activePoster.image_assignments={...(activePoster.image_assignments||{}),[slotKey]:added[0].id};await savePosterNow()}imageInput.value="";selectedImageId=null;renderImageLibrary();renderImageSlots();refreshPosterPreview();toast(added.length+" photo"+(added.length===1?"":"s")+" uploaded.")}


window.addEventListener("message", event => {
  const frame = $("#posterFrame");
  if (event.source !== frame.contentWindow || !event.data || event.data.type !== "POSTER_STUDIO_DROP_IMAGE") return;
  if (!activePoster || !activeTemplate) return;
  const key = String(event.data.key || "");
  const allowed = (activeTemplate.placeholder_schema?.images || []).some(slot => slot.key === key);
  const imageId = Number(event.data.imageId);
  if (allowed && Number.isInteger(imageId)) assignImage(imageId, key);
});

initControls();
loadAll();