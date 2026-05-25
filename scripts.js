/**
 * Note: Lightweight DOM helper functions were removed because they were
 * defined but not referenced anywhere in the codebase.
 */

/**
 * Stepper: manages step navigation and delegates step-specific logic to
 * handler classes. Keep the Stepper focused on navigation, state
 * management, and persistence; move UI-specific behaviour into handlers.
 */
/*
 * Utils: small collection of pure helpers kept in-file to reduce
 * duplication and make intent clearer. These are intentionally
 * lightweight and DOM-agnostic where practical.
 */
const Utils = {
    getById(id) {
        return document.getElementById(id);
    },
    isChecked(id) {
        const el = document.getElementById(id);
        return !!el && !!el.checked;
    },
    show(el) {
        if (!el) return;
        if (typeof el === 'string') el = document.getElementById(el);
        el.classList.remove('hidden');
    },
    hide(el) {
        if (!el) return;
        if (typeof el === 'string') el = document.getElementById(el);
        el.classList.add('hidden');
    },
    clearFieldsetInputs(fieldset) {
        if (!fieldset) return;
        const inputs = fieldset.querySelectorAll('input, select, textarea');
        inputs.forEach(i => {
            if (i.type === 'radio' || i.type === 'checkbox') i.checked = false;
            else i.value = '';
        });
    },
    addDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    },
    extractInputValuesByName(name) {
        return Array.from(document.querySelectorAll(`input[name="${name}"]`))
            .map(i => i.value?.trim())
            .filter(Boolean);
    },
    parseLatestTaxYear(values) {
        const years = values.flatMap((value) => {
            return Array.from(value.matchAll(/\b(19|20)\d{2}\b/g), (match) => parseInt(match[0], 10));
        });

        return years.length ? Math.max(...years) : null;
    },
    formatDate(value) {
        if (!value) return "N/A";
        const date = new Date(value);
        if (isNaN(date)) return value;
        return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }
};

class Stepper {
    constructor(stepSelector) {
        this.steps = Array.from(document.querySelectorAll(stepSelector));
        this.activeStep = this.steps.find(step => step.classList.contains('active'));
        this.observeStepContentChanges();

        this.stepHandlers = {}; // Store step instances
        this.loadStoredData();
        this.updateStepNumbers();
        this.customStepCode(this.steps.indexOf(this.activeStep));
    }

    adjustMaxHeight(step) {
        if (!step) return;
        const stepContent = step.querySelector('.step-content');
        if (stepContent) {
            stepContent.style.maxHeight = stepContent.scrollHeight + 'px';
        }
    }

    setActive(step) {
        if (!step) return;

        if (this.activeStep) {

            this.activeStep.classList.remove('active');
            const stepContent = this.activeStep.querySelector('.step-content');
            if (stepContent) {
                stepContent.style.maxHeight = null;
            }
        }

        step.classList.add('active');
        this.activeStep = step;

        this.updateStepNumbers();
        this.loadStoredDataForStep(this.steps.indexOf(this.activeStep));
        this.customStepCode(this.steps.indexOf(this.activeStep));

        //this.adjustMaxHeight(step); //hiding this fixed the accordion issue, unknown other effects/imapcts though
    }

    updateStepNumbers() {
        this.steps.forEach((step, index) => {
            let stepNumberElement = step.querySelector('.step-number');
            if (!stepNumberElement) return;

            const isActive = step === this.activeStep;
            const isCompleted = index < this.steps.indexOf(this.activeStep);

            this.styleStepNumber(stepNumberElement, index, isActive, isCompleted);
        });
    }


    styleStepNumber(element, index, isActive, isCompleted) {
        element.style.backgroundColor = isActive || isCompleted ? "#26374A" : "#6F6F6F";
        element.style.color = "#FFFFFF";

        if (index === 0 && !isCompleted) {
            // First step gets the 'info' icon
            element.innerHTML = `<strong>i</strong>`;
        } else {
            // Other steps display their number
            element.innerHTML = isCompleted ? `<span class="material-icons">check</span>` : `${index}`;
        }
    }

    observeStepContentChanges() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === "childList") {
                    this.adjustMaxHeight(this.activeStep); // ✅ Auto-adjust height when new elements are added
                }
            });
        });

        this.steps.forEach(step => {
            const stepContent = step.querySelector('.step-content');
            if (stepContent) {
                observer.observe(stepContent, {
                    childList: true,
                    subtree: true
                });
            }
        });
    }

    navigateStep(direction) {
        const currentIndex = this.steps.indexOf(this.activeStep);
        const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

        if (targetIndex >= 0 && targetIndex < this.steps.length) {
            this.storeData(currentIndex);
            this.setActive(this.steps[targetIndex]);
        }
    }

    /**
     * Collect form inputs for a step, normalize arrays and checkbox groups,
     * and return a plain object ready for persistence.
     */
    storeData(stepNum) {
        const stepForm = document.querySelector(`#step-${stepNum}-form`);
        let dataObj = {};

        if (stepForm) {
            dataObj = this.parseFormInputs(stepForm);
            this.removeEmptyArrays(dataObj);
        }

        if (stepNum === 1) {
            const bizSummary = this.buildBusinessNumberSummary(stepForm);
            if (bizSummary.length) dataObj["s1biz-accounttype"] = bizSummary;
            this.removeBizRawFields(dataObj);
        }

        // Step 2: include notices table if present
        if (stepNum === 2) {
            if (this.stepHandlers[2]?.noticesTable) {
                dataObj["notices"] = this.stepHandlers[2].noticesTable.rows;
            }
        }

        DataManager.saveData(`stepData_${stepNum}`, dataObj);
    }

    // --- Small helper methods to keep `storeData` readable ---
    parseFormInputs(stepForm) {
        const dataObj = {};
        const allInputs = stepForm.querySelectorAll("input, select, textarea");

        allInputs.forEach(input => {
            if (input.closest('.hidden')) return;
            const name = input.name;
            if (!name) return;
            // Normalize inputs into a plain object. Handles arrays (data-array),
            // radios, and checkbox groups so persistence code can treat values consistently.
            // Arrays: elements marked data-array (multiple tax years, etc.)
            if (input.dataset.array === "true") {
                if (!dataObj[name]) dataObj[name] = [];
                if (input.value !== "") dataObj[name].push(input.value);
                return;
            }

            if (input.type === "radio") {
                if (input.checked) dataObj[name] = input.value;
                return;
            }

            if (input.type === "checkbox") {
                if (!dataObj[name]) dataObj[name] = [];
                if (input.checked) dataObj[name].push(input.value);
                return;
            }

            // Default inputs
            dataObj[name] = input.value;
        });

        return dataObj;
    }

    removeEmptyArrays(obj) {
        Object.keys(obj).forEach(k => {
            if (Array.isArray(obj[k]) && obj[k].length === 0) delete obj[k];
        });
    }

    removeBizRawFields(obj) {
        Object.keys(obj).forEach(k => {
            if (/^s1biz-(BN9|BN4|bnfreeform)/i.test(k)) delete obj[k];
            if (/^s1biz-accounttype-/i.test(k)) delete obj[k];
        });
    }

    buildBusinessNumberSummary(stepForm) {
        const summary = [];

        const mappings = [
            { checkbox: "s1biz-accounttype-op1", label: "Corporation income tax", prefix: "RC", bn9: "s1biz-BN9-RC", bn4: "s1biz-BN4-RC" },
            { checkbox: "s1biz-accounttype-op2", label: "GST/HST", prefix: "RT", bn9: "s1biz-BN9-RT", bn4: "s1biz-BN4-RT" },
            { checkbox: "s1biz-accounttype-op3", label: "Payroll", prefix: "RP", bn9: "s1biz-BN9-RP", bn4: "s1biz-BN4-RP" },
            { checkbox: "s1biz-accounttype-op4", label: "Air Travellers Security Charge", prefix: "ZA", bn9: "s1biz-BN9-ZA", bn4: "s1biz-BN4-ZA" },
            { checkbox: "s1biz-accounttype-op5", label: "Excise Duty", prefix: "RD", bn9: "s1biz-BN9-RD", bn4: "s1biz-BN4-RD" },
            { checkbox: "s1biz-accounttype-op6", label: "Excise Tax on Insurance Premiums", prefix: "RN", bn9: "s1biz-BN9-RN", bn4: "s1biz-BN4-RN" },
            { checkbox: "s1biz-accounttype-op7", label: "Fuel Charge", prefix: "CT", bn9: "s1biz-BN9-CT", bn4: "s1biz-BN4-CT" },
            { checkbox: "s1biz-accounttype-op8", label: "Luxury Tax", prefix: "LT", bn9: "s1biz-BN9-LT", bn4: "s1biz-BN4-LT" },
            { checkbox: "s1biz-accounttype-op9", label: "Underused Housing Tax", prefix: "RU", bn9: "s1biz-BN9-RU", bn4: "s1biz-BN4-RU" },
            { checkbox: "s1biz-accounttype-op11", label: "Global minimum tax", prefix: "PT", bn9: "s1biz-BN9-PT", bn4: "s1biz-BN4-PT" }
        ];

        mappings.forEach(m => {
            const cb = document.getElementById(m.checkbox);

            // If account-type checkbox is selected, build a readable summary
            if (cb && cb.checked) {
                const bn9 = document.getElementById(m.bn9)?.value?.trim() || "";
                const bn4 = document.getElementById(m.bn4)?.value?.trim() || "";

                // Combine BN9 + prefix + BN4 into a compact identifier for review
                const fullNumber = `${bn9} ${m.prefix}${bn4}`.trim();

                summary.push(`${m.label} (${fullNumber})`);
            }
        });

        // Use comma+space to separate multiple account entries in the review
        return summary.join(", ");
    }
    loadStoredData() {
        this.steps.forEach((step, index) => {
            this.loadStoredDataForStep(index);
        });
    }

    loadStoredDataForStep(stepNum) {
        const step = this.steps[stepNum];
        if (!step) return;

        let savedData = DataManager.getData(`stepData_${stepNum}`);
        if (!savedData) return;

        Object.keys(savedData).forEach(key => {
            let input = step.querySelector(`[name="${key}"]`);
            if (input) {
                if (input.type === "radio" || input.type === "checkbox") {
                    if (input.value === savedData[key]) {
                        input.checked = true;
                    }
                } else {
                    input.value = savedData[key];
                }
            }
        });
    }

    customStepCode(stepNum) {
        if (!this.stepHandlers[stepNum]) {
            switch (stepNum) {
                case 1:
                    this.stepHandlers[stepNum] = new Step1Handler();
                    break;
                case 2:
                    this.stepHandlers[stepNum] = new Step2Handler();
                    break;
                case 3:
                    this.stepHandlers[stepNum] = new Step3Handler(this);
                    break;

            }
        }
        if (stepNum == 2) {

            this.stepHandlers[stepNum].onActivate();
        }
    }
}
class Step1Handler {
    constructor() {

        this.userFlow = null;

        this.canadaAddress = document.getElementById("canada-address");
        this.internationalAddress = document.getElementById("international-address");
        this.countryDropdown = document.getElementById("s1-country");
        this.countryDropdown.addEventListener("change", () => {
            this.showAddress(this.countryDropdown.value);
        });

        this.businessAccountFieldset = document.getElementById("s1biz-bizaccount-fieldset");
        this.userTypeFieldset = document.getElementById("s1q7-fieldset");
        this.userTypeFieldset.addEventListener("change", () => {

            this.userFlow = this.userTypeFieldset.querySelector("input:checked").getAttribute("data-flow");

            this.updateAddressFieldLabels();

        })


        this.accountFieldset = document.getElementById("s1biz-bn-fieldset");
        this.telephoneNumFieldset = document.getElementById("telephone-fieldset");
        this.mailingAddressFieldset = document.getElementById("mailing-fieldset");
        this.contactNameFieldset = document.getElementById("contactname-fieldset");


        this.indThirdPartyNumber = document.getElementById("s1-ind-thirdpartyref-fieldset");

    }

    updateAddressFieldLabels() {
        const telLabel = this.telephoneNumFieldset.querySelector("label").childNodes[1];
        const mailingLabel = this.mailingAddressFieldset.querySelector("label").childNodes[1];


        if (this.userFlow === "2") {
            telLabel.textContent = "Contact telephone number";
            this.contactNameFieldset.classList.remove("hidden");
            mailingLabel.textContent = "Business address";
        } else if (this.userFlow === "3") {

            telLabel.textContent = "Telephone number";
            this.contactNameFieldset.classList.add("hidden");
            mailingLabel.textContent = "Mailing address";

        } else {
            telLabel.textContent = "Telephone number";
            this.contactNameFieldset.classList.add("hidden");
            mailingLabel.textContent = "Mailing address";

        }
    }


    showAddress(selectedValue) {
        if (selectedValue === "Canada") {
            this.canadaAddress.classList.remove("hidden");
            this.internationalAddress.classList.add("hidden");
        } else {
            this.canadaAddress.classList.add("hidden");
            this.internationalAddress.classList.remove("hidden");
        }

    }

}
class Step2Handler {
    constructor() {

        this.noticeLightbox = new FormLightbox(document.getElementById("addnotice-lightbox"));
        this.excisetaxLightbox = new FormLightbox(document.getElementById("excisetax-lightbox"));

        this.notices = [];
        this.noticesTable = new TableObj("tb-add-notice");

        this.largeCorpQuestionRC = document.getElementById("s2q0-rc-fieldset");
        this.largeCorpQuestionRT = document.getElementById("s2q0-rt-fieldset");
        this.setupListeners();

        this.noticeDateField = document.getElementById("s2-noticedate-field");

        this.extensionFieldset = document.getElementById("s2-timeextension-fieldset");

        this.userType = this.getUserType();

        // ids of the business account-type checkboxes in Step 1
        this.corpCheckboxId = 's1biz-accounttype-op1';
        this.gstCheckboxId = 's1biz-accounttype-op2';

        // react to saved Step 1 changes (DataManager.saveData triggers 'dataUpdated')
        document.addEventListener('dataUpdated', (e) => {
            if (e?.detail?.key === 'stepData_1') {
                this.userType = this.getUserType();
                this.renderLargeCorpQuestion();
                this.updateNoticesHeader();
                this.updateObjectionDescriptionText();
            }
        });

        // react to direct checkbox toggles in Step 1 (live)
        const corpCheckboxEl = document.getElementById(this.corpCheckboxId);
        const gstCheckboxEl = document.getElementById(this.gstCheckboxId);

        const accountTypeChanged = () => {
            this.userType = this.getUserType();
            this.renderLargeCorpQuestion();
            this.updateNoticesHeader();
            this.updateObjectionDescriptionText();
        };

        if (corpCheckboxEl) {
            corpCheckboxEl.addEventListener('change', accountTypeChanged);
        }
        if (gstCheckboxEl) {
            gstCheckboxEl.addEventListener('change', accountTypeChanged);
        }

        this.taxYearsFieldset = document.getElementById("tax-years-fieldset");
        this.fiscalFieldset = document.getElementById("fiscal-period-fieldset");

        this.taxYearsContainer = document.getElementById("tax-years-container");
        this.addTaxYearBtn = document.getElementById("add-tax-year-btn");

        this.lineNumbersContainer = document.getElementById("linenumbers-container");
        this.addLineNumberBtn = document.getElementById("add-linenumber-btn");

        // Use ListBuilder for dynamic list inputs
        if (this.taxYearsContainer) {
            this.taxYearListBuilder = new ListBuilder({
                container: this.taxYearsContainer,
                inputType: 'text',
                inputName: 's2q3',
                inputClasses: ['tax-year-input', 'quarter-width'],
                rowClasses: ['tax-year-row', 'inline-flex', 'align-center'],
                deleteButtonText: 'Delete'

            });
        }

        if (this.lineNumbersContainer) {
            this.lineNumberListBuilder = new ListBuilder({
                container: this.lineNumbersContainer,
                inputType: 'text',
                inputName: 's2q4',
                inputClasses: ['linenumber-input', 'half-width'],
                rowClasses: ['line-number-row', 'inline-flex', 'align-center'],
                deleteButtonText: 'Delete'
            });
        }

        if (this.addTaxYearBtn) {
            this.addTaxYearBtn.addEventListener("click", () => this.taxYearListBuilder?.addInput());
        }
        if (this.addLineNumberBtn) {
            this.addLineNumberBtn.addEventListener("click", () => this.lineNumberListBuilder?.addInput());
        }

        if (this.taxYearsContainer) {
            this.taxYearsContainer.addEventListener("input", () => this.handleNoticeDateChange());
        }
        if (this.fiscalFieldset) {
            this.fiscalFieldset.addEventListener("input", () => this.handleNoticeDateChange());
        }




    }

    setupListeners() {
        document.addEventListener("lightboxSubmitted", (event) => {
            if (event.detail.lightboxId === "addnotice-lightbox") {
                this.handleFormSubmit(event.detail.formData);
            }
        });

        document.addEventListener("editRowEvent", (e) => {
            if (e.detail.tableID === "tb-add-notice") {
                this.noticeLightbox.setEditIndex(e.detail.index);
                this.noticeLightbox.populateForm(e.detail.rowData);
                this.noticeLightbox.openLightbox();

            }
        });

        document.addEventListener("rowDeleted", () => {
            DataManager.saveData("notices", this.noticesTable.rows);


        });
    }

    handleFormSubmit(formData) {
        const editIndex = this.noticeLightbox.getEditIndex();
        const newNotice = this.getNewNoticeFromForm(formData);

        this.updateNoticeTable(newNotice, editIndex);
        this.handleNoticeDateChange();
    }
    getNewNoticeFromForm(formData) {

        let noticeDate = formData["s2noticedate"];
        let taxYear;

        // For businesses we store a reporting period (start → end). For individuals
        // we accept one or more tax years (may be an array from multiple inputs).
        if (this.userType === "Business") {
            taxYear = `${formData["s2_fiscalperiodstart"]} to ${formData["s2_fiscalperiodend"]}`;
        } else {
            taxYear = Array.isArray(formData["s2q3"]) ? formData["s2q3"].join(", ") : formData["s2q3"];
        }

        return {
            noticeDate: noticeDate,
            taxYear: taxYear
        };

    }


    updateNoticeTable(newNotice, editIndex) {
        if (editIndex !== null && editIndex !== undefined && editIndex !== "") {
            this.notices[editIndex] = newNotice;
            this.noticeLightbox.clearEditIndex();
            this.noticesTable.rows[editIndex] = {
                noticeDate: newNotice.noticeDate,
                taxYear: newNotice.taxYear
            };
            this.noticesTable.refreshTable();
        } else {
            this.notices.push(newNotice);
            this.noticesTable.addRow({
                noticeDate: newNotice.noticeDate,
                taxYear: newNotice.taxYear
            });
        }
        DataManager.saveData("notices", this.noticesTable.rows);
    }

    getUserType() {
        const step1 = DataManager.getData("stepData_1");
        const normalized = {
            "A business": "Business",
            "A trust": "Trust",
            "An individual": "Individual"
        };

        this.userType = normalized[step1?.s1q7];
        return this.userType;
    }
    onActivate() {
        this.getUserType();
        this.setYearOrFiscalField();

        // render or remove large-corporation question before the notices table
        this.renderLargeCorpQuestion();
        // update notices table header label (Tax year → Reporting period for business)
        this.updateNoticesHeader();
        this.updateObjectionDescriptionText();

        if (this.noticeDateField?.value) {
            this.handleNoticeDateChange();
        }
    }

    renderLargeCorpQuestion() {
        const isBusinessFlow = this.userType === 'Business';

        const rcSelected = isBusinessFlow && this.isBusinessAccountTypeSelected(this.corpCheckboxId, 'RC');
        const rtSelected = isBusinessFlow && this.isBusinessAccountTypeSelected(this.gstCheckboxId, 'RT');

        if (this.largeCorpQuestionRC) {
            this.largeCorpQuestionRC.classList.toggle('hidden', !rcSelected);
            if (!rcSelected) {
                this.clearFieldsetInputs(this.largeCorpQuestionRC);
            }
        }

        if (this.largeCorpQuestionRT) {
            this.largeCorpQuestionRT.classList.toggle('hidden', !rtSelected);
            if (!rtSelected) {
                this.clearFieldsetInputs(this.largeCorpQuestionRT);
            }
        }
    }

    isBusinessAccountTypeSelected(checkboxId, prefix) {
        const checkboxSelected = !!document.getElementById(checkboxId)?.checked;
        const saved = DataManager.getData('stepData_1')?.['s1biz-accounttype'];
        const summaryHasType = typeof saved === 'string' && saved.includes(`(${prefix})`);
        return checkboxSelected || summaryHasType;
    }

    clearFieldsetInputs(fieldset) {
        if (!fieldset) return;
        const inputs = fieldset.querySelectorAll('input');
        inputs.forEach(i => {
            if (i.type === 'radio' || i.type === 'checkbox') i.checked = false;
            else i.value = '';
        });
    }

    updateNoticesHeader() {
        const table = document.getElementById('tb-add-notice');
        if (!table) return;
        const ths = table.querySelectorAll('thead th');
        if (!ths || ths.length < 2) return;
        ths[1].textContent = this.userType === 'Business' ? 'Reporting period' : 'Tax year';
    }

    updateObjectionDescriptionText() {
        const descriptionEl = document.getElementById('s2q2-sub-label');
        if (!descriptionEl) return;

        const userType = this.getUserType();
        const rcSelected = this.isBusinessRCSelected();

        if (userType === 'Business') {
            if (rcSelected) {
                descriptionEl.textContent = 'Reasonably describe each issue to be decided, specify the amount of relief sought for each issue and provide the facts and reasons relied upon for each issue.';
            } else {
                descriptionEl.textContent = 'Reasonably describe the issue and include how you think CRA misunderstood the facts of the situation or applied the law incorrectly when making their assessment.';
            }
        } else {
            descriptionEl.textContent = 'You should include how you think CRA misunderstood the facts of your situation or applied the law incorrectly when making their assessment';
        }
    }

    isBusinessRCSelected() {
        const checkboxSelected = !!document.getElementById(this.corpCheckboxId)?.checked;
        const saved = DataManager.getData('stepData_1')?.['s1biz-accounttype'];
        const summaryHasCorp = typeof saved === 'string' && /Corporation/i.test(saved);
        return checkboxSelected || summaryHasCorp;
    }

    setYearOrFiscalField() {

        if (!this.userType) return;

        // Toggle the UI between individual tax-years and business fiscal reporting period
        if (this.userType === "Business") {
            this.taxYearsFieldset.classList.add("hidden");
            this.fiscalFieldset.classList.remove("hidden");
        } else {
            this.taxYearsFieldset.classList.remove("hidden");
            this.fiscalFieldset.classList.add("hidden");
        }
    }

    handleNoticeDateChange() {
        const dateValue = this.noticeDateField.value;
        const showExtension = this.isMoreThan90Days(dateValue);

        if (this.extensionFieldset) {
            this.extensionFieldset.classList.toggle("hidden", !showExtension);
        }
    }

    isMoreThan90Days(dateStr) {
        const noticeDate = new Date(dateStr);
        if (isNaN(noticeDate)) return false;

        const noticeDeadline = Utils.addDays(noticeDate, 90);
        const returnDeadline = this.getLatestReturnDeadline();
        const comparisonDate = new Date();

        if (returnDeadline) {
            return comparisonDate > (returnDeadline > noticeDeadline ? returnDeadline : noticeDeadline);
        }

        return comparisonDate > noticeDeadline;
    }

    getLatestReturnDeadline() {
        const taxYearValues = this.getLatestTaxYearValues();
        const latestYear = Utils.parseLatestTaxYear(taxYearValues);
        if (!latestYear) {
            return null;
        }

        const step1 = DataManager.getData("stepData_1") || {};
        const userType = this.getUserType();
        const selfEmployed = step1["s1ind-selfemployed"] === "Yes";
        const filingYear = latestYear + 1;

        if (userType === "Individual") {
            const month = selfEmployed ? 5 : 3; // June 15 or April 30
            const day = selfEmployed ? 15 : 30;
            return new Date(filingYear, month, day);
        }

        return new Date(filingYear, 3, 30); // April 30 for non-individual returns
    }

    getLatestTaxYearValues() {
        const values = Utils.extractInputValuesByName('s2q3');
        if (values.length === 0) {
            const fiscalEnd = document.querySelector('input[name="s2_fiscalperiodend"]')?.value;
            if (fiscalEnd?.trim()) values.push(fiscalEnd.trim());
        }
        return values;
    }

    parseLatestTaxYear(values) {
        return Utils.parseLatestTaxYear(values);
    }

    addDays(date, days) {
        return Utils.addDays(date, days);
    }
}

class Step3Handler {
    constructor(stepper) {
        this.stepper = stepper;
        this.reviewContainer = document.getElementById("s3-review-container");
        this.submitBtn = document.getElementById("appsubmit-btn");
        this.populateReview();

        // Listen for navigation events
        document.addEventListener("navigateToStep", (event) => {
            this.stepper.setActive(this.stepper.steps[event.detail.index]);
        });

        this.submitBtn.addEventListener('click', () => {
            sessionStorage.setItem("navigatingToConfirmation", "true");
            // Store necessary data in sessionStorage to retrieve on confirmation page


            // Redirect to confirmation page
            window.location.href = "confirmation.html";
        });
    }

    populateReview() {
        this.reviewContainer.innerHTML = ""; // Clear previous content

        const steps = [{
            stepNum: 1,
            title: "Provide objection information",
            storageKey: "stepData_1"
        },
        {
            stepNum: 2,
            title: "Describe your objection",
            storageKey: "stepData_2"

        }
        ];
        steps.forEach(({
            stepNum,
            title,
            storageKey,
            labels
        }) => {
            let data = DataManager.getData(storageKey);
            if (!data) return;

            // Clean out any raw business-number or per-checkbox account-type fields that may have been saved earlier
            let cleaned = false;
            Object.keys(data).forEach(k => {
                if (/^s1biz-(BN9|BN4|bnfreeform|accounttype-)/i.test(k)) {
                    delete data[k];
                    cleaned = true;
                }
            });
            if (cleaned) {
                DataManager.saveData(storageKey, data);
            }

            // Replace field names with question labels
            let formattedData = {};
            let subTableData = null; // Placeholder for subtable


            Object.keys(data).forEach(key => {
                // Skip raw business-number and per-checkbox account-type fields so review only shows the amalgamated summary
                if (/^s1biz-(BN9|BN4|bnfreeform|accounttype-)/i.test(key)) return;

                let value = data[key];
                if (value == null) return;

                // If a field is stored as an array (multiple checkboxes/inputs),
                // join with ", " so the review shows a readable list with spaces.
                if (Array.isArray(value)) {
                    value = value.join(", ");
                }

                if (key === "notices") {
                    subTableData = {
                        title: "Notices you added",
                        headers: ["Notice date", "Tax year"],
                        columns: ["noticeDate", "taxYear"],
                        rows: value
                    };
                    return;
                }

                if (key === "s1biz-accounttype") {
                    const label = "Select the business account type.";
                    formattedData[label] = Array.isArray(value) ? value.join("<br>") : value;
                    return;
                }

                // Format dates
                if (key.toLowerCase().includes("date")) {
                    value = this.formatDate(value);
                }

                // Use proper labels
                const label = this.getLabelForInput(key);
                formattedData[label] = value;
            });
            new PanelObj({
                container: this.reviewContainer,
                title: title,
                data: formattedData, // Use the formatted data with proper labels
                editButton: true,
                editIndex: stepNum,
                reviewPanel: true,
                subTable: subTableData
            });
        });

        // Listen for edit button clicks
        document.addEventListener("editPanelEvent", (event) => {
            this.stepper.setActive(this.stepper.steps[event.detail.index]);
        });
    }

    formatDate(value) {
        return Utils.formatDate(value);
    }


    getLabelForInput(name) {
        let label = "";
        // Prefer the fieldset legend for grouped inputs (checkbox/radio groups).
        const fieldElement = document.querySelector(`fieldset [name="${name}"]`);
        if (fieldElement) {
            const fs = fieldElement.closest("fieldset");

            // Determine if this "name" represents a group (multiple inputs with same name)
            const sameNameCount = fs.querySelectorAll(`[name="${name}"]`).length;

            if (sameNameCount > 1) {
                // It's a group — prefer <legend> or a standalone group <label>
                const legend = fs.querySelector("legend");
                if (legend) {
                    const cloned = legend.cloneNode(true);
                    cloned.querySelectorAll('a, span, .label-ast').forEach(el => el.remove());
                    label = cloned.textContent.trim();
                } else {
                    const candidateLabels = Array.from(fs.querySelectorAll('label[for]'));
                    for (const lab of candidateLabels) {
                        const forVal = lab.getAttribute('for');
                        if (!fs.querySelector(`#${CSS.escape(forVal)}`)) {
                            const cloned = lab.cloneNode(true);
                            cloned.querySelectorAll('a, span, .label-ast').forEach(el => el.remove());
                            label = cloned.textContent.trim();
                            break;
                        }
                    }
                }
            }
            // If sameNameCount === 1 we won't use the group label — fallthrough to
            // single-input label handling below so individual inputs (like
            // thirdpartyref) keep their own labels.
        }

        // Fallback: handle a standard <label for="..."> for single inputs
        if (!label) {
            const input = document.querySelector(`[name="${name}"]`);
            if (input) {
                const labelElement = document.querySelector(`label[for="${input.id}"]`);
                if (labelElement) {
                    const cloned = labelElement.cloneNode(true);
                    // Remove help links/icons and asterisks
                    cloned.querySelectorAll('a, span, .label-ast').forEach(el => el.remove());
                    label = cloned.textContent.trim();
                }
                // If there's no direct <label for="id"> (common when international
                // and domestic share a label), attempt to derive a base id by
                // stripping a known suffix like 'international' and look for a
                // label for that base id (e.g., s1-mailinginternational -> s1-mailing).
                if (!label && input.id && input.id.includes('international')) {
                    const baseId = input.id.replace('international', '');
                    const baseLabel = document.querySelector(`label[for="${baseId}"]`);
                    if (baseLabel) {
                        const clonedBase = baseLabel.cloneNode(true);
                        clonedBase.querySelectorAll('a, span, .label-ast').forEach(el => el.remove());
                        label = clonedBase.textContent.trim();
                    }
                }
            }
        }

        // Final cleanup: remove any leftover asterisks or whitespace
        return label.replace(/^\*\s*/, "").trim() || name;
    }


}

class CharacterCounter {
    constructor(textarea) {
        this.textarea = textarea;
        this.maxLength = parseInt(textarea.dataset.maxlength, 10) || null;

        this.counterEl = document.createElement("div");
        this.counterEl.classList.add("char-counter");

        textarea.insertAdjacentElement("afterend", this.counterEl);

        this.updateCount();

        textarea.addEventListener("input", () => {
            this.updateCount();
        });
    }

    updateCount() {
        const currentLength = this.textarea.value.length;

        if (this.maxLength) {
            this.counterEl.textContent = `${currentLength} / ${this.maxLength} characters`;
        } else {
            this.counterEl.textContent = `${currentLength} characters`;
        }
    }
}

class ListBuilder {
    constructor({
        container,
        inputType = 'text',
        inputName,
        inputClasses = [],
        rowClasses = [],
        deleteButtonText = 'Delete',
        inputAttributes = {}
    }) {
        this.container = container;
        this.inputType = inputType;
        this.inputName = inputName;
        this.inputClasses = inputClasses;
        this.rowClasses = rowClasses;
        this.deleteButtonText = deleteButtonText;
        this.inputAttributes = inputAttributes;
    }
    addInput() {
        if (!this.container) return;
        // Build a row containing the input and a delete button. The input is
        // marked with `data-array=true` so the Stepper parser treats it as an array.
        const row = document.createElement('div');
        row.classList.add(...this.rowClasses);
        row.style.alignItems = 'center';

        const input = document.createElement('input');
        input.type = this.inputType;
        input.name = this.inputName;
        input.dataset.array = 'true';

        input.classList.add(...this.inputClasses);

        // Apply any additional attributes (min/max for number inputs, etc.)
        Object.entries(this.inputAttributes).forEach(([key, value]) => {
            input.setAttribute(key, value);
        });

        // Delete button simply removes the row from the DOM
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.classList.add('btn', 'btn-tertiary', 'ml-8px');

        deleteButton.innerHTML = `
            <span class="material-icons">close</span>
            ${this.deleteButtonText}
        `;

        deleteButton.addEventListener('click', () => {
            row.remove();
        });

        row.appendChild(input);
        row.appendChild(deleteButton);

        this.container.appendChild(row);
    }
}

class PanelObj {
    constructor({
        container,
        title,
        data,
        editButton = false,
        editIndex = null,
        deleteButton = false,
        reviewPanel = false,
        labels = null,
        subTable = null
    }) {
        this.container = container; // The DOM element where the panel should be appended
        this.title = title;
        this.data = data;
        this.editButton = editButton;
        this.editIndex = editIndex;
        this.deleteButton = deleteButton;
        this.reviewPanel = reviewPanel;
        this.labels = labels; // Store optional labels
        this.subTable = subTable;

        this.render();
    }

    render() {

        this.panelElement = document.createElement("div");
        this.panelElement.classList.add("panel");

        let editButtonHTML = this.editButton ?
            `<button type="button" class="btn-tertiary edit-btn" data-index="${this.editIndex}"><span class="material-icons">edit</span>Edit</button>` : "";

        let deleteButtonHTML = this.deleteButton ?
            `<button type="button" class="btn-tertiary delete-btn" data-index="${this.editIndex}"><span class="material-icons">delete</span>Delete</button>` : "";
        // Generate table rows for main data
        let tableRows = Object.entries(this.data)
            .map(([key, value], index) => {
                if (value) {
                    let label = this.labels && this.labels[index] ? this.labels[index] : this.formatKey(key);
                    return `<tr><td class="label">${label}</td><td>${value}</td></tr>`;
                }

            })
            .join("");

        let subTableHTML = "";

        // Generate sub-table dynamically if data is provided
        if (this.subTable && this.subTable.rows && this.subTable.rows.length > 0) {
            subTableHTML = `
                <h5>${this.subTable.title || "Subtable"}</h5>
                <table class="review-table" cellpadding="0" cellspacing="0">
                    <thead>
                        <tr>
                            ${this.subTable.headers.map(header => `<th>${header}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${this.subTable.rows.map(row => `
                            <tr>
                                ${this.subTable.columns.map(column => `<td>${row[column] || "N/A"}</td>`).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;
        }

        this.panelElement.innerHTML = `
            <div class="heading-row">
                <h5>${this.title}</h5>
                <div>
                ${editButtonHTML}
                ${deleteButtonHTML}
                </div>
                
            </div>
            <table class="panel-data">
                ${tableRows}
            </table>
            <div>

            ${subTableHTML} <!-- Dynamically insert sub-table if applicable -->
                        </div>

        `;

        this.container.appendChild(this.panelElement);

        const editButton = this.panelElement.querySelector(".edit-btn");

        if (editButton) {
            editButton.addEventListener("click", () => this.emitEditEvent());
        }
        const deleteButton = this.panelElement.querySelector(".delete-btn");

        if (deleteButton) {
            deleteButton.addEventListener("click", () => this.emitDeleteEvent());
        }
    }

    formatKey(key) {
        return key
            .replace(/([A-Z]{2,})/g, match => match) // Keep acronyms like SIN intact
            .replace(/([a-z])([A-Z])/g, "$1 $2") // Insert spaces only between words
            .replace(/^./, str => str.toUpperCase()) // Capitalize first letter
            .trim();
    }

    emitEditEvent() {
        if (this.reviewPanel) {
            document.dispatchEvent(new CustomEvent("navigateToStep", {
                detail: {
                    index: this.editIndex
                }
            }));
        } else {
            document.dispatchEvent(new CustomEvent("editPanelEvent", {
                detail: {
                    index: this.editIndex,
                    panelTitle: this.title,
                    panelData: this.data
                }
            }));
        }
    }
    emitDeleteEvent() {
        document.dispatchEvent(new CustomEvent("deletePanelEvent", {
            detail: {
                index: this.editIndex,
                panelTitle: this.title
            }
        }));
    }
}

class TableObj {
    constructor(tableID, {
        allowEdit = true,
        allowDelete = true
    } = {}) {
        this.table = document.getElementById(tableID);
        this.tbody = this.table.querySelector("tbody");
        this.defaultText = this.tbody.dataset.placeholder;
        this.columnCount = this.table.querySelector("thead tr").children.length;
        this.rows = []; // Store data for easier access


        this.allowEdit = allowEdit;
        this.allowDelete = allowDelete;

        // Initialize the table with placeholder text if empty
        this.renderEmptyTable();
    }
    renderEmptyTable() {
        this.tbody.innerHTML = `<tr><td colspan="${this.columnCount + 1}" style="text-align:center;">${this.defaultText}</td></tr>`;
    }
    addRow(data, rowIndex = this.rows.length) {
        // If the table is displaying the default placeholder row, clear it
        if (this.tbody.querySelector("tr") && this.tbody.querySelector("tr").cells.length === 1) {
            this.tbody.innerHTML = "";
        }
        this.rows[rowIndex] = data; // Ensure correct index assignment

        // Create a new row
        const tr = document.createElement("tr");

        // Populate row with data
        Object.values(data).forEach((value) => {
            const td = document.createElement("td");
            td.textContent = value || "N/A"; // Handle empty fields
            tr.appendChild(td);
        });

        // Actions column (placeholder for buttons)
        const actionTd = document.createElement("td");
        let actionHTML = "";

        if (this.allowEdit) {
            actionHTML += `
                <button type="button" class="btn-tertiary edit-btn" data-index="${rowIndex}">
                    <span class="material-icons">edit</span>Edit
                </button>
            `;
        }

        if (this.allowDelete) {
            actionHTML += `
                <button type="button" class="btn-tertiary delete-btn" data-index="${rowIndex}">
                    <span class="material-icons">close</span>Delete
                </button>
            `;
        }

        actionTd.innerHTML = actionHTML;
        tr.appendChild(actionTd);

        // Append row to table
        this.tbody.appendChild(tr);

        // Attach event listeners
        if (this.allowEdit) {
            actionTd.querySelector(".edit-btn")?.addEventListener("click", (event) => {
                this.emitEditEvent(event.target.closest(".edit-btn").dataset.index);
            });
        }

        if (this.allowDelete) {
            actionTd.querySelector(".delete-btn")?.addEventListener("click", (event) => {
                this.deleteRow(event.target.closest(".delete-btn").dataset.index);
            });
        }

    }

    emitEditEvent(index) {
        index = parseInt(index);
        if (!this.rows[index]) return;

        // Dispatch an event so Step5Handler (or other handlers) can respond
        document.dispatchEvent(new CustomEvent("editRowEvent", {
            detail: {
                tableID: this.table.id,
                index: index,
                rowData: this.rows[index]
            }
        }));
    }
    deleteRow(index) {
        index = parseInt(index);
        // Remove the data at `index` and redraw the table to keep UI in sync
        this.rows.splice(index, 1);
        this.refreshTable();

        // Notify listeners that a row was deleted so persistence/UI can update
        document.dispatchEvent(new CustomEvent("rowDeleted", {
            detail: {
                tableID: this.table.id
            }
        }));
    }
    refreshTable() {
        this.tbody.innerHTML = ""; // Clear the table

        if (this.rows.length === 0) {
            this.renderEmptyTable();
            return;
        }

        this.rows.forEach((rowData, index) => {
            this.addRow(rowData, index);
        });
    }
}

class DatepickerObj {
    constructor(inputId) {
        this.input = document.getElementById(inputId);
        this.wrapper = this.input.closest(".input-wrapper");
        this.icon = this.wrapper.querySelector(".suffix");
        this.modal = this.wrapper.querySelector(".datepicker-modal");

        // Open on icon click
        this.icon.addEventListener("click", (e) => {
            e.stopPropagation();
            DatepickerObj.closeAll(); // Close other open ones
            this.open();
        });

        // Close if clicking outside
        document.addEventListener("click", (e) => {
            if (!this.wrapper.contains(e.target)) {
                this.close();
            }
        });
    }
    open() {
        const today = new Date();
        this.selectedYear = today.getFullYear();
        this.selectedMonth = today.getMonth();
        this.renderDayView(this.selectedYear, this.selectedMonth);
        this.modal.classList.remove("hidden");
        // Prevent clicks inside the modal from closing it
        this.modal.addEventListener("click", (e) => e.stopPropagation());

        // Mark this step-content as open
        const stepContent = this.wrapper.closest(".step-content");
        if (stepContent) stepContent.classList.add("modal-open");
    }
    close() {
        this.modal.classList.add("hidden");
        const stepContent = this.wrapper.closest(".step-content");
        if (stepContent) stepContent.classList.remove("modal-open");
    }



    static closeAll() {
        document.querySelectorAll(".datepicker-modal").forEach(modal => {
            modal.classList.add("hidden");
        });
    }
    renderDayView(year, month) {
        this.modal.innerHTML = "";

        const container = document.createElement("div");
        container.classList.add("datepicker-grid");

        // Header
        const header = document.createElement("div");
        header.classList.add("datepicker-header");

        // Left: title + dropdown
        const left = document.createElement("div");
        left.classList.add("datepicker-header-left");

        const title = document.createElement("button");
        title.classList.add("datepicker-title-btn");
        title.innerHTML = `${this.getMonthName(month)} ${year} <span class="arrow">▼</span>`;
        title.onclick = () => this.renderYearRange(year - (year % 24));
        left.appendChild(title);

        // Right: arrows
        const right = document.createElement("div");
        right.classList.add("datepicker-header-right");

        const prev = document.createElement("span");
        prev.innerHTML = "&lsaquo;";
        prev.classList.add("datepicker-nav");
        prev.onclick = () => {
            const newMonth = month === 0 ? 11 : month - 1;
            const newYear = month === 0 ? year - 1 : year;
            this.selectedYear = newYear;
            this.selectedMonth = newMonth;
            this.renderDayView(newYear, newMonth);
        };

        const next = document.createElement("span");
        next.innerHTML = "&rsaquo;";
        next.classList.add("datepicker-nav");
        next.onclick = () => {
            const newMonth = month === 11 ? 0 : month + 1;
            const newYear = month === 11 ? year + 1 : year;
            this.selectedYear = newYear;
            this.selectedMonth = newMonth;
            this.renderDayView(newYear, newMonth);
        };

        right.appendChild(prev);
        right.appendChild(next);

        // Final header assembly
        header.appendChild(left);
        header.appendChild(right);
        container.appendChild(header);

        // Weekday headers
        const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const weekdayRow = document.createElement("div");
        weekdayRow.classList.add("day-row");
        weekdays.forEach(d => {
            const day = document.createElement("div");
            day.classList.add("day-name");
            day.textContent = d;
            weekdayRow.appendChild(day);
        });
        container.appendChild(weekdayRow);

        // Day cells
        const grid = document.createElement("div");
        grid.classList.add("day-grid");

        const firstDay = new Date(year, month, 1).getDay();
        const totalDays = new Date(year, month + 1, 0).getDate();

        // Empty slots
        for (let i = 0; i < firstDay; i++) {
            const empty = document.createElement("div");
            empty.classList.add("day-cell", "empty");
            grid.appendChild(empty);
        }

        for (let i = 1; i <= totalDays; i++) {
            const cell = document.createElement("div");
            cell.classList.add("day-cell");
            cell.textContent = i;
            cell.onclick = () => this.selectDate(year, month, i);
            grid.appendChild(cell);
        }

        container.appendChild(grid);
        this.modal.appendChild(container);
    }

    renderYearRange(startYear = this.getCurrent24Start()) {
        this.modal.innerHTML = ""; // Clear modal

        const container = document.createElement("div");
        container.classList.add("datepicker-grid");

        // Header
        const header = document.createElement("div");
        header.classList.add("datepicker-header");

        const prev = document.createElement("span");
        prev.innerHTML = "&lsaquo;";
        prev.classList.add("datepicker-nav");
        prev.onclick = () => this.renderYearRange(startYearAdjusted - 24);

        const title = document.createElement("div");
        title.classList.add("datepicker-title");
        title.textContent = `${startYear} - ${startYear + 23}`;

        const next = document.createElement("span");
        next.innerHTML = "&rsaquo;";
        next.classList.add("datepicker-nav");

        //next.onclick = () => this.renderYearRange(startYear + 24);
        next.style.visibility = "hidden";
        header.appendChild(prev);
        header.appendChild(title);
        header.appendChild(next);
        container.appendChild(header);

        // Year grid
        const grid = document.createElement("div");
        grid.classList.add("year-grid");

        const currentYear = new Date().getFullYear();
        const endYear = currentYear;
        const startYearAdjusted = endYear - 23;

        for (let i = 0; i < 24; i++) {
            const year = startYearAdjusted + i;
            const cell = document.createElement("div");
            cell.classList.add("datepicker-cell");
            cell.textContent = year;

            // Only enable if it's <= current year
            cell.classList.add("clickable");
            cell.onclick = () => this.handleYearClick(year);

            grid.appendChild(cell);
        }
        title.textContent = `${startYearAdjusted} - ${endYear}`;


        container.appendChild(grid);
        this.modal.appendChild(container);
    }

    renderMonthView(year) {
        this.modal.innerHTML = ""; // Clear modal

        const container = document.createElement("div");
        container.classList.add("datepicker-grid");

        // Header with back arrow and year label
        const header = document.createElement("div");
        header.classList.add("datepicker-header");

        const back = document.createElement("span");
        back.innerHTML = "&lsaquo;";
        back.classList.add("datepicker-nav");
        back.onclick = () => this.renderYearRange(this.getCurrent24Start(year));

        const title = document.createElement("div");
        title.classList.add("datepicker-title");
        title.textContent = year;

        header.appendChild(back);
        header.appendChild(title);
        container.appendChild(header);

        // Month grid
        const grid = document.createElement("div");
        grid.classList.add("month-grid");

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
        ];

        monthNames.forEach((name, index) => {
            const cell = document.createElement("div");
            cell.classList.add("datepicker-cell");
            cell.textContent = name;
            cell.onclick = () => {
                this.selectedMonth = index;
                this.renderDayView(year, index);
            };
            grid.appendChild(cell);
        });

        container.appendChild(grid);
        this.modal.appendChild(container);
    }

    getCurrent24Start(current = new Date().getFullYear()) {
        return current - 23;
    }
    handleYearClick(year) {
        this.selectedYear = year;
        this.renderMonthView(year); // Call month view after picking a year
    }
    selectDate(year, month, day) {
        const formatted = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        this.input.value = formatted;
        this.input.dispatchEvent(new CustomEvent('dateSelected', {
            detail: {
                value: this.input.value
            }
        }));
        this.modal.classList.add("hidden");
    }

    getMonthName(index) {
        return ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ][index];
    }



}

class DataManager {
    static saveData(key, value) {
        sessionStorage.setItem(key, JSON.stringify(value));
        document.dispatchEvent(new CustomEvent("dataUpdated", {
            detail: {
                key,
                data: value
            }
        }));
    }
    static getData(key) {
        let data = sessionStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    }

}

class FormLightbox {
    constructor(lightbox) {
        this.lightbox = lightbox;
        this.form = this.lightbox.querySelector('form');
        this.openTrigger = document.querySelector(`[data-togglelb="${lightbox.id}"]`);
        this.submitButton = this.lightbox.querySelector('[data-submit]');
        this.editIndex = null;

        if (this.openTrigger) {
            this.openTrigger.addEventListener('click', () => {
                this.openLightbox();
                this.clearFormData();
            });
            if (this.openTrigger.value) {
                var buttonText = document.createTextNode(this.openTrigger.value);
                this.openTrigger.appendChild(buttonText)
            }
        }
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        this.lightbox.querySelectorAll('[data-closebtn]').forEach(btn => {
            btn.addEventListener('click', () => this.closeLightbox());
        });

        if (this.submitButton) {
            this.submitButton.addEventListener('click', (event) => {
                event.preventDefault();
                this.sendFormData();

            });
        }
    }
    openLightbox() {
        this.lightbox.classList.add('open');
    }

    closeLightbox() {
        this.lightbox.classList.remove('open');
        this.clearEditIndex();
    }

    clearFormData() {
        if (!this.form) return;
        this.form.querySelectorAll("input, select, textarea").forEach(input => {
            if (input.type === "checkbox" || input.type === "radio") {
                input.checked = false;
            } else {
                input.value = "";

            }
        });
        let hiddenEls = this.form.querySelectorAll("[data-inithidden]");
        if (hiddenEls.length > 0) {
            hiddenEls.forEach(el => {
                el.classList.add("hidden");
            })
        }
        // Reset spans with data-formelement
        this.form.querySelectorAll("[data-formelement]").forEach(span => {
            span.textContent = span.dataset.placeholder || "";
        });
    }

    populateForm(data) {
        if (!this.form) return;
        Object.keys(data).forEach((key) => {
            const input = this.form.querySelector(`[name="${key}"]`);
            if (input) input.value = data[key];
        });
    }

    sendFormData() {
        const formData = new FormData(this.form);
        let dataObj = {};

        formData.forEach((value, key) => {
            dataObj[key] = value;
        });

        document.dispatchEvent(new CustomEvent("lightboxSubmitted", {
            detail: {
                lightboxId: this.lightbox.id,
                formData: dataObj
            }
        }));

        this.closeLightbox();
    }

    setEditIndex(index) {
        this.editIndex = index;
    }

    getEditIndex() {
        return this.editIndex;
    }
    clearEditIndex() {
        this.editIndex = null;
    }
}

class ProgressiveDisclosure {
    constructor(stepperInstance = null) {
        this.stepper = stepperInstance;
        this.initializeEventListeners();
        this.outConditions = [
            //step 1 selections that result in an "out"
            ["s0q1-op2"],
            ["s1q2-op1"],
            ["s1q2-op3"],
            ["s1q3-op2"]
        ];

    }

    initializeEventListeners() {
        // Attach change event to all elements with the `data-toggle` attribute
        document.querySelectorAll('[data-toggle], input[type="radio"], input[type="checkbox"]').forEach(input => {

            input.addEventListener('change', this.handleInputChange.bind(this));


        });

    }

    handleInputChange(event) {
        this.handleToggle(event); // Ensure Progressive Disclosure still works
        this.outCheck(); // Check if the user should be redirected
    }

    handleToggle(event) {
        const input = event.target;
        const toggleTargets = input.getAttribute('data-toggle');



        // Hide all sibling toggle targets in the same group
        this.hideOtherTargets(input);

        // If the current input has a data-toggle, handle its targets
        if (toggleTargets) {
            const targetIds = toggleTargets.split(',').map(id => id.trim());
            targetIds.forEach(targetId => {
                const targetElement = document.getElementById(targetId);
                if (!targetElement) {
                    console.error(`Element with ID '${targetId}' not found.`);
                    return;
                }

                if (input.type === "select-one") {
                    const options = input.childNodes;

                    options.forEach(option => {
                        if (option.selected) {
                            if (option.value != null) {
                                targetElement.classList.remove('hidden');
                            }
                        }
                    });
                }
                if (input.type === "date") {
                    targetElement.classList.remove("hidden");

                }

                if (input.checked) {
                    targetElement.classList.remove('hidden');
                }
            });
        }

        // Adjust stepper height if available
        if (this.stepper) {
            const currStep = this.stepper.activeStep;
            this.stepper.adjustMaxHeight(currStep);
        }
    }


    hideOtherTargets(input) {
        const groupName = input.name;

        if (groupName) {
            const groupInputs = document.querySelectorAll(`input[name="${groupName}"]`);

            groupInputs.forEach(groupInput => {
                const otherTargets = groupInput.getAttribute('data-toggle');

                if (otherTargets) {
                    const targetIds = otherTargets.split(',').map(id => id.trim());

                    targetIds.forEach(targetId => {
                        const targetElement = document.getElementById(targetId);
                        if (targetElement) {
                            this.hideWithSubfields(targetElement);
                        }
                    });
                }
            });

            // Hide all subsequent fieldsets if the current input triggers an out
            const parentFieldset = input.closest("fieldset");
            if (parentFieldset && parentFieldset.classList.contains("hidden")) {
                let nextFieldset = parentFieldset.nextElementSibling;
                while (nextFieldset) {
                    if (nextFieldset.tagName === "FIELDSET") {
                        this.hideWithSubfields(nextFieldset);
                    }
                    nextFieldset = nextFieldset.nextElementSibling;
                }
            }
        }
    }


    hideWithSubfields(element) {
        element.classList.add("hidden");


        // Clear all inputs inside the hidden element
        const inputs = element.querySelectorAll('input, select, select-one, textarea, option');
        inputs.forEach(input => {
            if (input.type === 'radio' || input.type === 'checkbox') {
                input.checked = false;
            } else if (input.type === 'text') {
                input.value = '';

            } else if (input.type === 'select-one') {
                input.selectedIndex = 0;
            }

        });

        // Recursively hide any nested fields inside this element
        const nestedToggles = element.querySelectorAll('[data-toggle]');
        nestedToggles.forEach(nestedToggle => {
            const nestedTargets = nestedToggle.getAttribute('data-toggle');
            if (nestedTargets) {
                nestedTargets.split(',').forEach(nestedTargetId => {
                    const nestedTargetElement = document.getElementById(nestedTargetId.trim());
                    if (nestedTargetElement) {
                        this.hideWithSubfields(nestedTargetElement);
                    }
                });
            }
        });
    }

    outCheck() {
        let selectedInputs = Array.from(document.querySelectorAll('input:checked')).map(input => input.id);

        let isOut = this.outConditions.some(conditionSet => conditionSet.every(id => selectedInputs.includes(id)));

        this.updateNavigationButtons(isOut);

    }

    updateNavigationButtons(isOut) {
        const activeStep = document.querySelector('.step.active'); // Get the current active step
        if (!activeStep) return;

        const nextBtn = activeStep.querySelector('.next-button');
        const backBtn = activeStep.querySelector('.back-button');
        const outBtn = activeStep.querySelector('.out-button');

        if (!outBtn) return; // If no next button is found, exit

        if (activeStep.id === 'step-0') {
            const firstQuestionYes = document.getElementById('s0q1-op1')?.checked;
            const firstQuestionNo = document.getElementById('s0q1-op2')?.checked;
            const anotherReasonSelected = document.getElementById('s0q2-op5')?.checked;

            const s0q2op1 = document.getElementById('s0q2-op1')?.checked;
            const s0q2op2 = document.getElementById('s0q2-op2')?.checked;
            const s0q2op3 = document.getElementById('s0q2-op3')?.checked;
            const s0q2op4 = document.getElementById('s0q2-op4')?.checked;

            // Show Return to Canada.ca when user answered 'No' to first question
            // or when they selected one of the first four options in s0q2
            if (firstQuestionNo || (firstQuestionYes && (s0q2op1 || s0q2op2 || s0q2op3 || s0q2op4))) {
                nextBtn?.classList.add('hidden');
                outBtn.classList.remove('hidden');
            } else if (firstQuestionYes && anotherReasonSelected) {
                // Begin only when first question is Yes AND s0q2 'Another reason' is selected
                nextBtn?.classList.remove('hidden');
                outBtn.classList.add('hidden');
            } else {
                // No buttons until required path is chosen
                nextBtn?.classList.add('hidden');
                outBtn.classList.add('hidden');
            }

            if (backBtn) {
                backBtn.classList.add('hidden');
            }
            return;
        }

        if (isOut) {
            nextBtn.classList.add("hidden");
            if (backBtn)
                backBtn.classList.add("hidden");

            outBtn.classList.remove("hidden");

        } else {
            nextBtn.classList.remove("hidden");
            if (backBtn)
                backBtn.classList.remove("hidden");

            outBtn.classList.add("hidden");
        }
    }

}

document.addEventListener('DOMContentLoaded', () => {


    // Initialize Stepper
    const stepper = new Stepper('.step');



    // Initialize ProgressiveDisclosure and pass the stepper instance
    new ProgressiveDisclosure(stepper);

    // Load the last step from session storage (no jumpStep implementation available)
    // const savedStepId = sessionStorage.getItem('currentStep');
    // If you later implement `Stepper.jumpStep(id)` you can restore the saved step here.

    // Add event listeners to all next buttons
    document.querySelector('.stepper').addEventListener('click', (event) => {
        if (event.target.classList.contains('next-button')) {
            stepper.navigateStep('next');

        } else if (event.target.classList.contains('back-button')) {
            stepper.navigateStep('back');

        }
    });

    // Populate radio button labels with their 'value'
    const inputsWithLabels = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    inputsWithLabels.forEach(input => {
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) {
            label.textContent = input.value;

        }
    });

    document.querySelectorAll("textarea[data-maxlength]").forEach(textarea => {
        new CharacterCounter(textarea);
    });

    //Add asterisks to all required fields
    const requiredInputs = document.querySelectorAll('.required-label');
    requiredInputs.forEach(input => {
        if (input) {

            const asterisk = document.createElement('span');
            asterisk.textContent = '* ';
            asterisk.classList.add('label-ast');

            input.insertBefore(asterisk, input.firstChild);
        }
    });


    //Accordion functionality
    const accordions = document.querySelectorAll('.accordion');
    accordions.forEach(accordion => {
        accordion.addEventListener('click', function () {
            this.classList.toggle('active');

        });
    });

});

window.addEventListener('beforeunload', (event) => {
    if (!sessionStorage.getItem("navigatingToConfirmation")) {
        sessionStorage.clear();
    }
    sessionStorage.removeItem("navigatingToConfirmation"); // Reset flag after navigation
});