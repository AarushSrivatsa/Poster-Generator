const app = Vue.createApp({
  delimiters: ["[[", "]]"],
  data() {
    return {
      view: "posters",
      loading: true,
      busy: "",
      toastMessage: "",
      toastTimer: null,
      cars: [],
      makes: [],
      templates: [],
      posters: [],
      carSearch: "",
      makeSearch: "",
      templateSearch: "",
      posterSearch: "",
      carDialogOpen: false,
      editingCarId: null,
      carForm: this.emptyCarForm(),
      editingCarImages: [],
      pendingPhotos: [],
      carPhotoDragging: false,
      makeDialogOpen: false,
      editingMakeId: null,
      makeForm: {name: ""},
      makeLogoFile: null,
      makeLogoPreview: "",
      templateDialogOpen: false,
      editingTemplateId: null,
      templateForm: {name:"", html_content:""},
      templateStarterId: null,
      templateNameTouched: false,
      placeholderGroups: [
        {title:"Vehicle information",description:"Automatically filled from the vehicle record.",items:[
          {token:"{{car.make}}",label:"Manufacturer"},{token:"{{car.model}}",label:"Model"},{token:"{{car.variant}}",label:"Variant"},
          {token:"{{car.year}}",label:"Year"},{token:"{{car.registration_no}}",label:"Registration number"},{token:"{{car.fuel_type}}",label:"Fuel type"},
          {token:"{{car.transmission}}",label:"Transmission"},{token:"{{car.odometer_km}}",label:"Kilometres driven"},
          {token:"{{car.owner_count}}",label:"Ownership (1st, 2nd, 3rd…)"},{token:"{{car.insurance_validity}}",label:"Insurance validity"},
          {token:"{{car.fitness_validity}}",label:"Fitness validity"}
        ]},
        {title:"Manufacturer branding",description:"Use the name as text and the logo as an image source.",items:[
          {token:"{{make.name}}",label:"Manufacturer name"},{token:"{{make.icon}}",label:"Manufacturer logo"}
        ]},
        {title:"Images",description:"Generic photo placements. Each number can hold any vehicle photo; the numbers do not describe photo types.",items:[
          {token:"{{image.1}}",label:"Image 1"},{token:"{{image.2}}",label:"Image 2"},
          {token:"{{image.3}}",label:"Image 3"},{token:"{{image.4}}",label:"Image 4"}
        ],tip:"These are not fixed photo types. Use {{image.5}}, {{image.6}}, or any further number when the layout needs more photo placements."},
        {title:"Editable poster text",description:"These become fields the customer can fill separately on each poster.",items:[
          {token:"{{text.eyebrow}}",label:"Small heading"},{token:"{{text.price}}",label:"Selling price"},
          {token:"{{text.tagline}}",label:"Short description"},{token:"{{text.contact}}",label:"Contact information"}
        ],tip:"You can add more text fields with any name, such as {{text.offer}} or {{text.phone}}. Each becomes its own editable field on the poster."}
      ],
      templatePreviewHtml: "",
      templatePreviewLoading: false,
      templatePreviewError: "",
      templatePreviewTimer: null,
      templatePreviewRequestId: 0,
      posterCreateOpen: false,
      posterDraft: {car_id:null, template_id:null},
      activePoster: null,
      activeCar: null,
      activeTemplate: null,
      selectedImageId: null,
      slotDropKey: "",
      photoDropActive: false,
      saveState: "saved",
      posterSaveTimer: null,
      posterSavePromise: null,
      previewVersion: 0,

    };
  },
  computed: {
    pageTitle() {
      return ({posters:"Posters", cars:"Vehicles", makes:"Manufacturers", templates:"Templates"})[this.view] || "Workspace";
    },
    years() {
      const result = [];
      for (let year = new Date().getFullYear() + 1; year >= 1980; year--) result.push(year);
      return result;
    },
    fuelTypes() {
      return ["Petrol","Diesel","CNG","Petrol + CNG","LPG","Petrol + LPG","Electric","Hybrid","Plug-in Hybrid","Hydrogen"];
    },
    transmissionTypes() {
      return ["Manual","AMT","Torque Converter Automatic","CVT","DCT / DSG","iMT","e-CVT","Single-speed EV"];
    },
    filteredCars() {
      const q = this.carSearch.trim().toLowerCase();
      return this.cars.filter(car => [car.make?.name,car.model,car.variant,car.registration_no,car.year].join(" ").toLowerCase().includes(q));
    },
    filteredMakes() {
      const q = this.makeSearch.trim().toLowerCase();
      return this.makes.filter(make => make.name.toLowerCase().includes(q));
    },
    filteredTemplates() {
      const q = this.templateSearch.trim().toLowerCase();
      return this.templates.filter(template => template.name.toLowerCase().includes(q));
    },
    starterTemplates() {
      return this.templates.filter(template => template.is_builtin);
    },
    filteredPosters() {
      const q = this.posterSearch.trim().toLowerCase();
      return this.posters.filter(poster => [poster.name,this.carTitle(poster.car_id),this.templateFor(poster.template_id)?.name].join(" ").toLowerCase().includes(q));
    },
    detectedTokens() {
      const matches = this.templateForm.html_content.match(/\{\{\s*[a-zA-Z][a-zA-Z0-9_.-]{0,79}\s*\}\}/g) || [];
      return [...new Set(matches.map(item => item.replace(/\{\{|\}\}/g, "").trim()))];
    },
    activeTextFields() {
      return this.activeTemplate?.placeholder_schema?.text || [];
    },
    activeImageSlots() {
      return this.activeTemplate?.placeholder_schema?.images || [];
    },
    previewUrl() {
      return this.activePoster ? "/api/posters/" + this.activePoster.id + "/render?v=" + this.previewVersion : "about:blank";
    },
    saveStateLabel() {
      return this.saveState === "saving" ? "Saving changes…" : this.saveState === "error" ? "Save failed" : "All changes saved";
    }
  },
  methods: {
    emptyCarForm() {
      return {make_id:"",model:"",variant:"",registration_no:"",fuel_type:"",year:"",transmission:"",odometer_km:"",owner_count:"",insurance_mode:"lapsed",insurance_date:"",fitness_mode:"lapsed",fitness_year:""};
    },
    async api(url, options) {
      const response = await fetch(url, options || {});
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (response.status >= 500) {
          throw new Error("Something went wrong on our side. Please try again.");
        }
        throw new Error(payload.detail || response.statusText || "Request failed");
      }
      if (response.status === 204) return {};
      return response.json();
    },
    json(payload) {
      return {headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)};
    },
    notify(message) {
      this.toastMessage = message;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { this.toastMessage = ""; }, 3500);
    },
    handleError(error) {
      console.error(error);
      this.notify(error.message || "Something went wrong.");
    },
    async loadAll() {
      this.loading = true;
      try {
        const results = await Promise.all([
          this.api("/api/cars"),
          this.api("/api/makes"),
          this.api("/api/templates"),
          this.api("/api/posters")
        ]);
        this.cars = results[0];
        this.makes = results[1];
        this.templates = results[2];
        this.posters = results[3];
      } catch (error) {
        this.handleError(error);
      } finally {
        this.loading = false;
      }
    },
    navigate(view) {
      if (this.view === "editor" && this.activePoster) this.savePosterNow().catch(this.handleError);
      this.view = view;
      this.activePoster = null;
      this.activeCar = null;
      this.activeTemplate = null;
    },
    carTitle(carId) {
      const car = this.cars.find(item => item.id === Number(carId));
      return car ? [car.make?.name, car.model, car.variant].filter(Boolean).join(" ") : "Vehicle";
    },
    templateFor(templateId) {
      return this.templates.find(item => item.id === Number(templateId));
    },
    formatDate(value) {
      if (!value) return "just now";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "recently";
      return date.toLocaleDateString(undefined, {month:"short", day:"numeric"});
    },
    expiryPayload() {
      return {
        insurance_validity: this.carForm.insurance_mode === "lapsed" ? "Lapsed" : this.carForm.insurance_date,
        fitness_validity: this.carForm.fitness_mode === "lapsed" ? "Lapsed" : this.carForm.fitness_year
      };
    },
    openCarDialog(car) {
      this.editingCarId = car?.id || null;
      this.carForm = car ? {
        make_id:String(car.make_id),
        model:car.model || "",
        variant:car.variant || "",
        registration_no:car.registration_no || "",
        fuel_type:car.fuel_type || "",
        year:String(car.year || ""),
        transmission:car.transmission || "",
        odometer_km:car.odometer_km == null ? "" : String(car.odometer_km),
        owner_count:car.owner_count == null ? "" : String(car.owner_count),
        insurance_mode:car.insurance_validity ? "date" : "lapsed",
        insurance_date:car.insurance_validity ? String(car.insurance_validity).slice(0,7) : "",
        fitness_mode:car.fitness_validity ? "date" : "lapsed",
        fitness_year:car.fitness_validity ? String(car.fitness_validity).slice(0,4) : ""
      } : this.emptyCarForm();
      this.editingCarImages = car ? (car.images || []).map(image => ({...image})) : [];
      this.clearPendingPhotos();
      this.carDialogOpen = true;
    },
    closeCarDialog() {
      this.carDialogOpen = false;
      this.clearPendingPhotos();
    },
    addCarPhotos(fileList) {
      const allowed = ["image/jpeg","image/png","image/webp","image/avif"];
      Array.from(fileList || []).forEach(file => {
        if (!allowed.includes(file.type)) {
          this.notify(file.name + " is not a supported image.");
          return;
        }
        if (file.size > 12 * 1024 * 1024) {
          this.notify(file.name + " is larger than 12 MB.");
          return;
        }
        this.pendingPhotos.push({
          id: Date.now() + Math.floor(Math.random() * 1000000),
          file,
          imageType: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g," "),
          previewUrl: URL.createObjectURL(file)
        });
      });
    },
    removePendingPhoto(photo) {
      URL.revokeObjectURL(photo.previewUrl);
      this.pendingPhotos = this.pendingPhotos.filter(item => item.id !== photo.id);
    },
    clearPendingPhotos() {
      this.pendingPhotos.forEach(photo => URL.revokeObjectURL(photo.previewUrl));
      this.pendingPhotos = [];
    },
    async uploadPendingPhotos(carId) {
      if (!this.pendingPhotos.length) return;
      const body = new FormData();
      this.pendingPhotos.forEach(photo => {
        body.append("files", photo.file, photo.file.name);
        body.append("image_types", photo.imageType || "");
      });
      await this.api("/api/cars/" + carId + "/images", {method:"POST", body});
      this.clearPendingPhotos();
    },
    async saveCar(event) {
      const form = event.target;
      if (!form.reportValidity()) return;
      const payload = {
        make_id:this.carForm.make_id,
        model:this.carForm.model.trim(),
        variant:this.carForm.variant.trim(),
        registration_no:this.carForm.registration_no.trim(),
        fuel_type:this.carForm.fuel_type,
        year:this.carForm.year,
        transmission:this.carForm.transmission,
        odometer_km:this.carForm.odometer_km || null,
        owner_count:this.carForm.owner_count || null,
        ...this.expiryPayload()
      };
      const duplicateRegistration = this.cars.some(car =>
        String(car.registration_no || "").trim().toUpperCase() === payload.registration_no.toUpperCase()
        && car.id !== this.editingCarId
      );
      if (duplicateRegistration) return this.notify("That registration number is already saved. Check the vehicle record.");

      if (!payload.insurance_validity || payload.insurance_validity === "") return this.notify("Choose an insurance expiry month or mark it lapsed.");
      if (!payload.fitness_validity || payload.fitness_validity === "") return this.notify("Choose a fitness expiry year or mark it lapsed.");

      this.busy = "car";
      let carId = this.editingCarId;
      let detailsSaved = Boolean(carId);
      try {
        const response = await this.api(
          carId ? "/api/cars/" + carId : "/api/cars",
          {method:carId ? "PUT" : "POST", ...this.json(payload)}
        );
        carId = Number(response.id);
        this.editingCarId = carId;
        detailsSaved = true;
        await this.uploadPendingPhotos(carId);
        const updated = await this.api("/api/cars/" + carId);
        this.cars = [updated, ...this.cars.filter(item => item.id !== updated.id)];
        this.carDialogOpen = false;
        this.clearPendingPhotos();
        this.notify("Vehicle and photos saved.");
      } catch (error) {
        if (detailsSaved && carId) {
          try {
            const updated = await this.api("/api/cars/" + carId);
            this.cars = [updated, ...this.cars.filter(item => item.id !== updated.id)];
            this.notify("Vehicle details are saved. Photo upload failed; your selected files are still here. Press Save changes to retry.");
          } catch (_) {
            this.handleError(error);
          }
        } else {
          this.handleError(error);
        }
      } finally {
        this.busy = "";
      }
    },
    async saveImageType(image) {
      try {
        await this.api("/api/images/" + image.id, {method:"PATCH", ...this.json({image_type:image.image_type})});
        const car = this.cars.find(item => item.id === this.editingCarId);
        const saved = car?.images?.find(item => item.id === image.id);
        if (saved) saved.image_type = image.image_type;
        this.notify("Photo description saved.");
      } catch (error) { this.handleError(error); }
    },
    async removeSavedCarImage(image) {
      if (!confirm("Remove this photo from the vehicle?")) return;
      try {
        await this.api("/api/images/" + image.id, {method:"DELETE"});
        this.editingCarImages = this.editingCarImages.filter(item => item.id !== image.id);
        const car = this.cars.find(item => item.id === this.editingCarId);
        if (car) car.images = (car.images || []).filter(item => item.id !== image.id);
      } catch (error) { this.handleError(error); }
    },
    async deleteCar(car) {
      if (!confirm("Delete " + this.carTitle(car.id) + " and its photos and posters?")) return;
      try {
        await this.api("/api/cars/" + car.id, {method:"DELETE"});
        this.cars = this.cars.filter(item => item.id !== car.id);
        this.posters = this.posters.filter(item => item.car_id !== car.id);
        this.notify("Vehicle deleted.");
      } catch (error) { this.handleError(error); }
    },
    openMakeDialog(make) {
      this.editingMakeId = make?.id || null;
      this.makeForm = {name:make?.name || ""};
      this.makeLogoFile = null;
      this.makeLogoPreview = make?.icon_url || "";
      this.makeDialogOpen = true;
    },
    chooseMakeLogo(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      this.makeLogoFile = file;
      if (this.makeLogoPreview && this.makeLogoPreview.startsWith("blob:")) URL.revokeObjectURL(this.makeLogoPreview);
      this.makeLogoPreview = URL.createObjectURL(file);
    },
    closeMakeDialog() {
      if (this.makeLogoPreview && this.makeLogoPreview.startsWith("blob:")) URL.revokeObjectURL(this.makeLogoPreview);
      this.makeDialogOpen = false;
    },
    async saveMake() {
      const cleanName = this.makeForm.name.trim().toLowerCase();
      const duplicateMake = this.makes.some(make =>
        make.name.trim().toLowerCase() === cleanName && make.id !== this.editingMakeId
      );
      if (duplicateMake) return this.notify("That manufacturer is already in your list.");
      this.busy = "make";
      try {
        let make = this.editingMakeId
          ? await this.api("/api/makes/" + this.editingMakeId, {method:"PUT", ...this.json({name:this.makeForm.name.trim()})})
          : await this.api("/api/makes", {method:"POST", ...this.json({name:this.makeForm.name.trim()})});
        // Keep the record in edit mode if a newly added logo upload needs retry.
        this.editingMakeId = make.id;
        if (this.makeLogoFile) {
          const body = new FormData();
          body.append("file", this.makeLogoFile);
          make = await this.api("/api/makes/" + make.id + "/icon", {method:"POST", body});
        }
        this.makes = [make, ...this.makes.filter(item => item.id !== make.id)].sort((a,b) => a.name.localeCompare(b.name));
        this.cars = await this.api("/api/cars");
        this.closeMakeDialog();
        this.notify("Manufacturer saved.");
      } catch (error) { this.handleError(error); }
      finally { this.busy = ""; }
    },
    async deleteMake(make) {
      if (!confirm("Delete manufacturer " + make.name + "?")) return;
      try {
        await this.api("/api/makes/" + make.id, {method:"DELETE"});
        this.makes = this.makes.filter(item => item.id !== make.id);
        this.notify("Manufacturer deleted.");
      } catch (error) { this.handleError(error); }
    },
    uniqueTemplateName(baseName) {
      const base = (baseName || "My design").trim();
      let candidate = base;
      let suffix = 2;
      while (this.templates.some(item => item.name.toLowerCase() === candidate.toLowerCase())) {
        candidate = base + " " + suffix++;
      }
      return candidate;
    },
    openTemplateDialog(template) {
      this.editingTemplateId = template?.id || null;
      this.templateStarterId = null;
      this.templateNameTouched = false;
      this.templateForm = template
        ? {name:template.name, html_content:template.html_content}
        : {name:this.uniqueTemplateName("New template"), html_content:""};
      this.templatePreviewHtml = "";
      this.templatePreviewError = "";
      this.templatePreviewLoading = false;
      this.templateDialogOpen = true;
      if (template?.html_content) this.refreshTemplatePreview();
    },
    chooseTemplateStarter(starter) {
      if (!starter || !starter.html_content) return;
      this.templateStarterId = starter.id;
      if (!this.templateNameTouched) this.templateForm.name = this.uniqueTemplateName(starter.name + " Custom");
      this.templateForm.html_content = starter.html_content;
      this.scheduleTemplatePreview();
      this.notify("Design starting point changed.");
    },
    async copyPlaceholderGuide() {
      const guide = [
        "MOTOR STUDIO — VEHICLE POSTER PLACEHOLDERS",
        "Create a complete HTML/CSS vehicle poster using plain HTML and normal CSS only. Do not use Tailwind or Bootstrap utility classes. Put all styling in a style tag. Use these exact placeholders and keep the braces unchanged. Do not invent vehicle details.",
        "",
        "VEHICLE INFORMATION (automatically filled):",
        "{{car.make}} — make",
        "{{car.model}} — model",
        "{{car.variant}} — variant",
        "{{car.year}} — year",
        "{{car.registration_no}} — registration number",
        "{{car.fuel_type}} — fuel",
        "{{car.transmission}} — transmission",
        "{{car.odometer_km}} — kilometres driven",
        "{{car.owner_count}} — formatted ownership, e.g. 1st owner or 2nd owner",
        "{{car.insurance_validity}} — insurance validity",
        "{{car.fitness_validity}} — fitness validity",
        "",
        "MANUFACTURER BRANDING:",
        "{{make.name}} — manufacturer name",
        "{{make.icon}} — manufacturer logo URL (use as an image src)",
        "",
        "IMAGES (generic numbered photo placements; each can contain ANY vehicle photo):",
        '<img src="{{image.1}}" alt="Image 1">',
        '<img src="{{image.2}}" alt="Image 2">',
        '<img src="{{image.3}}" alt="Image 3">',
        '<img src="{{image.4}}" alt="Image 4">',
        "Use {{image.5}}, {{image.6}}, etc. for as many additional image placements as the design needs. They are not tied to front, rear, interior or any particular photo type.",
        "",
        "CUSTOM POSTER TEXT (editable separately for each poster):",
        "{{text.eyebrow}} — small heading",
        "{{text.price}} — selling price",
        "{{text.tagline}} — short description",
        "{{text.contact}} — contact details",
        "",
        "Use only the fields that fit the design. Use multiple image slots. Keep all placeholders exactly as written. The app automatically detects them; users do not need to configure them separately."
      ].join("\n");
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(guide);
        } else {
          const field = document.createElement("textarea");
          field.value = guide;
          field.setAttribute("readonly", "");
          field.style.position = "fixed";
          field.style.opacity = "0";
          document.body.appendChild(field);
          field.select();
          const copied = document.execCommand("copy");
          field.remove();
          if (!copied) throw new Error("Clipboard access is unavailable.");
        }
        this.notify("Copied the complete field guide. Paste it once into your AI design prompt.");
      } catch (error) {
        this.notify("Clipboard access was blocked. You can still read all fields in this window.");
      }
    },
    closeTemplateDialog() {
      clearTimeout(this.templatePreviewTimer);
      this.templateDialogOpen = false;
      this.templateStarterId = null;
      this.templatePreviewHtml = "";
      this.templatePreviewError = "";
    },
    scheduleTemplatePreview() {
      clearTimeout(this.templatePreviewTimer);
      this.templatePreviewRequestId += 1;
      this.templatePreviewTimer = setTimeout(() => this.refreshTemplatePreview(), 420);
    },
    async refreshTemplatePreview() {
      clearTimeout(this.templatePreviewTimer);
      if (!this.templateForm.html_content.trim()) {
        this.templatePreviewHtml = "";
        this.templatePreviewError = "";
        this.templatePreviewLoading = false;
        return;
      }
      const requestId = ++this.templatePreviewRequestId;
      this.templatePreviewLoading = true;
      this.templatePreviewError = "";
      try {
        const response = await fetch("/api/templates/preview", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({html_content:this.templateForm.html_content})
        });
        const html = await response.text();
        if (!response.ok) {
          let message = html || "Unable to render this template.";
          try { message = JSON.parse(html).detail || message; } catch (_) {}
          throw new Error(message);
        }
        if (requestId !== this.templatePreviewRequestId || !this.templateDialogOpen) return;
        this.templatePreviewHtml = html;
      } catch (error) {
        if (requestId === this.templatePreviewRequestId) {
          console.warn("Template preview could not be rendered:", error);
          this.templatePreviewHtml = "";
          this.templatePreviewError = "We couldn't show this preview. Your design is still here. Try refreshing, or choose another starting design.";
        }
      } finally {
        if (requestId === this.templatePreviewRequestId) this.templatePreviewLoading = false;
      }
    },
    async saveTemplate() {
      if (!this.templateForm.html_content.trim()) {
        this.notify("Paste your complete HTML design before saving.");
        return;
      }
      if (!this.detectedTokens.some(token => /^(car|make|image|text)\./.test(token))) {
        this.notify("No Motor Studio fields found. Add at least one placeholder from the field guide.");
        return;
      }
      if (!this.templateForm.name.trim()) {
        this.notify("Give this template a name before saving.");
        return;
      }
      this.busy = "template";
      try {
        const payload = {name:this.templateForm.name.trim(), html_content:this.templateForm.html_content};
        const duplicateName = this.templates.some(template =>
          template.name.trim().toLowerCase() === payload.name.toLowerCase()
          && template.id !== this.editingTemplateId
        );
        if (duplicateName) {
          this.busy = "";
          return this.notify("A template with that name already exists. Choose another name.");
        }
        if (this.editingTemplateId) {
          await this.api("/api/templates/" + this.editingTemplateId, {method:"PUT", ...this.json(payload)});
        } else {
          await this.api("/api/templates", {method:"POST", ...this.json(payload)});
        }
        this.templates = await this.api("/api/templates");
        this.closeTemplateDialog();
        this.notify("Template saved.");
      } catch (error) { this.handleError(error); }
      finally { this.busy = ""; }
    },
    async duplicateTemplate(template) {
      const payload = {
        name:this.uniqueTemplateName(template.name + " Copy"),
        html_content:template.html_content
      };
      try {
        const copy = await this.api("/api/templates", {method:"POST", ...this.json(payload)});
        this.templates = await this.api("/api/templates");
        this.openTemplateDialog(copy);
        this.notify("Template duplicated. Edit the copy and save it.");
      } catch (error) { this.handleError(error); }
    },
    async deleteTemplate(template) {
      if (!confirm("Delete template " + template.name + "?")) return;
      try {
        await this.api("/api/templates/" + template.id, {method:"DELETE"});
        this.templates = this.templates.filter(item => item.id !== template.id);
        this.posters = await this.api("/api/posters");
        this.notify("Template deleted.");
      } catch (error) { this.handleError(error); }
    },
    openPosterCreate() {
      this.posterDraft = {
        car_id:this.cars[0]?.id || null,
        template_id:this.templates[0]?.id || null
      };
      this.posterCreateOpen = true;
    },
    async createPoster() {
      this.busy = "poster";
      try {
        const poster = await this.api("/api/posters", {
          method:"POST",
          ...this.json({
            car_id:Number(this.posterDraft.car_id),
            template_id:Number(this.posterDraft.template_id)
          })
        });
        this.posters.unshift(poster);
        this.posterCreateOpen = false;
        await this.openPoster(poster.id);
        this.notify("Poster created.");
      } catch (error) { this.handleError(error); }
      finally { this.busy = ""; }
    },
    async openPoster(id) {
      try {
        const poster = await this.api("/api/posters/" + id);
        const car = await this.api("/api/cars/" + poster.car_id);
        const template = this.templateFor(poster.template_id) || await this.api("/api/templates/" + poster.template_id);
        this.activePoster = {
          ...poster,
          text_values:{...(poster.text_values || {})},
          image_assignments:{...(poster.image_assignments || {})}
        };
        this.activeCar = car;
        this.activeTemplate = template;
        this.selectedImageId = null;
        this.previewVersion += 1;
        this.saveState = "saved";
        this.view = "editor";
      } catch (error) { this.handleError(error); }
    },
    async leaveEditor() {
      try {
        await this.savePosterNow();
      } catch (_) {
        this.notify("Your changes could not be saved. The poster is still open—retry before leaving.");
        return;
      }
      this.view = "posters";
      this.activePoster = null;
      this.activeCar = null;
      this.activeTemplate = null;
    },
    savePosterSafely() {
      this.savePosterNow().catch(() => {});
    },
    schedulePosterSave() {
      this.saveState = "saving";
      clearTimeout(this.posterSaveTimer);
      this.posterSaveTimer = setTimeout(() => this.savePosterSafely(), 450);
    },
    async savePosterNow() {
      if (!this.activePoster) return;
      clearTimeout(this.posterSaveTimer);
      const currentId = this.activePoster.id;

      // Serialize autosaves so an older request cannot overwrite newer edits.
      if (this.posterSavePromise) {
        await this.posterSavePromise;
        if (this.activePoster && this.activePoster.id === currentId) {
          return this.savePosterNow();
        }
        return;
      }

      const payload = {
        name:this.activePoster.name || "",
        text_values:{...(this.activePoster.text_values || {})},
        image_assignments:{...(this.activePoster.image_assignments || {})}
      };
      this.saveState = "saving";
      const request = this.api("/api/posters/" + currentId, {method:"PUT", ...this.json(payload)});
      this.posterSavePromise = request;
      try {
        const updated = await request;
        if (!this.activePoster || this.activePoster.id !== currentId) return;
        this.activePoster.updated_at = updated.updated_at;
        this.posters = this.posters.map(item =>
          item.id === currentId
            ? {...item, name:payload.name, updated_at:updated.updated_at}
            : item
        );
        this.saveState = "saved";
        this.previewVersion += 1;
      } catch (error) {
        this.saveState = "error";
        this.handleError(error);
        throw error;
      } finally {
        if (this.posterSavePromise === request) this.posterSavePromise = null;
      }
    },
    refreshPreview() {
      this.previewVersion += 1;
    },
    assignedImage(key) {
      if (!this.activeCar || !this.activePoster) return null;
      const id = Number(this.activePoster.image_assignments[key]);
      return this.activeCar.images?.find(image => image.id === id) || null;
    },
    async assignImage(key, imageId) {
      if (!this.activePoster || !this.activeCar) return;
      const exists = this.activeCar.images?.some(image => image.id === Number(imageId));
      if (!exists) return;
      this.activePoster.image_assignments[key] = Number(imageId);
      this.selectedImageId = null;
      try { await this.savePosterNow(); }
      catch (error) { this.handleError(error); }
    },
    assignSelectedImage(key) {
      if (this.selectedImageId) this.assignImage(key, this.selectedImageId);
      else this.notify("Select a vehicle photo first.");
    },
    startImageDrag(event, image) {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("carImageId", String(image.id));
    },
    async dropImageOnSlot(event, key) {
      this.slotDropKey = "";
      const imageId = Number(event.dataTransfer.getData("carImageId"));
      if (imageId) return this.assignImage(key, imageId);
      if (event.dataTransfer.files?.length) return this.uploadEditorPhotos(event.dataTransfer.files, key);
    },
    async uploadEditorPhotos(fileList, slotKey) {
      const files = Array.from(fileList || []);
      if (!files.length || !this.activeCar) return;
      const body = new FormData();
      files.forEach(file => {
        body.append("files", file, file.name);
        body.append("image_types", file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g," "));
      });
      try {
        await this.api("/api/cars/" + this.activeCar.id + "/images", {method:"POST", body});
        this.activeCar = await this.api("/api/cars/" + this.activeCar.id);
        this.cars = this.cars.map(item => item.id === this.activeCar.id ? this.activeCar : item);
        if (slotKey && this.activeCar.images.length) {
          const latest = this.activeCar.images[this.activeCar.images.length - files.length];
          if (latest) await this.assignImage(slotKey, latest.id);
        }
        this.notify("Photos added to this vehicle.");
      } catch (error) { this.handleError(error); }
    },
    dropEditorPhotos(event) {
      this.photoDropActive = false;
      this.uploadEditorPhotos(event.dataTransfer.files);
    },
    async deleteEditorImage(image) {
      if (!confirm("Remove this photo from the vehicle? Any poster placement using it will be emptied.")) return;
      try {
        await this.api("/api/images/" + image.id, {method:"DELETE"});
        if (this.selectedImageId === image.id) this.selectedImageId = null;
        this.activeCar.images = this.activeCar.images.filter(item => item.id !== image.id);
        this.cars = this.cars.map(item => item.id === this.activeCar.id ? this.activeCar : item);
        const assignments = this.activePoster.image_assignments || {};
        Object.keys(assignments).forEach(key => { if (Number(assignments[key]) === image.id) delete assignments[key]; });
        await this.savePosterNow();
      } catch (error) { this.handleError(error); }
    },
    printPoster() {
      document.getElementById("posterFrame")?.contentWindow?.postMessage({type:"POSTER_STUDIO_PRINT"}, "*");
    },
    async duplicateActivePoster() {
      if (!this.activePoster) return;
      try {
        await this.savePosterNow();
        const created = await this.api("/api/posters", {
          method:"POST",
          ...this.json({
            car_id:this.activePoster.car_id,
            template_id:this.activePoster.template_id,
            name:(this.activePoster.name || this.activeTemplate.name) + " Copy"
          })
        });
        await this.api("/api/posters/" + created.id, {
          method:"PUT",
          ...this.json({
            name:created.name,
            text_values:this.activePoster.text_values,
            image_assignments:this.activePoster.image_assignments
          })
        });
        this.posters = await this.api("/api/posters");
        await this.openPoster(created.id);
        this.notify("Poster duplicated.");
      } catch (error) { this.handleError(error); }
    },
    async deletePoster(poster) {
      if (!confirm("Delete this poster?")) return;
      try {
        await this.api("/api/posters/" + poster.id, {method:"DELETE"});
        this.posters = this.posters.filter(item => item.id !== poster.id);
        this.notify("Poster deleted.");
      } catch (error) { this.handleError(error); }
    },
    async dropImageOnFrame(event) {
      const frame = document.getElementById("posterFrame");
      if (event.source !== frame?.contentWindow || event.data?.type !== "POSTER_STUDIO_DROP_IMAGE") return;
      if (!this.activePoster || !this.activeTemplate) return;
      const key = String(event.data.key || "");
      const allowed = this.activeImageSlots.some(slot => slot.key === key);
      const imageId = Number(event.data.imageId);
      if (allowed && Number.isInteger(imageId)) await this.assignImage(key, imageId);
    }
  },
  mounted() {
    this.loadAll();
    this._frameDropHandler = event => this.dropImageOnFrame(event);
    window.addEventListener("message", this._frameDropHandler);
  },
  beforeUnmount() {
    window.removeEventListener("message", this._frameDropHandler);
    clearTimeout(this.templatePreviewTimer);
    clearTimeout(this.toastTimer);
    clearTimeout(this.posterSaveTimer);
    this.clearPendingPhotos();
    if (this.makeLogoPreview.startsWith("blob:")) URL.revokeObjectURL(this.makeLogoPreview);
  }
});
app.mount("#app");
