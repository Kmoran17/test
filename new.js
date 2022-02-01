import { LightningElement, api, track } from 'lwc';

import { handleError, PRICING_FIELD_UPDATE_EVENT } from 'c/pricingAndProfitabilityService';

import calculateLabel from '@salesforce/label/c.Quick_Price_Calculate_Action';
import clearLabel from '@salesforce/label/c.Quick_Price_Clear_Action';
import saveLabel from '@salesforce/label/c.Quick_Price_Save_Action';

import invoke from '@salesforce/apex/nFORCE.AuraApi_v1.invoke';

export default class QuickPriceCalculator extends LightningElement {

	reinflationBeanName;
	newLoaderBeanName;

	@track modalController = new Array();
	modalConfig;
	scenarioId;
	fistBornChild;
	isThirdActionDisabled = true;
	isLoading = false;

	labels = {
		calculateLabel,
		clearLabel,
		saveLabel,
	};

	@api testController = this.modalController;

	set thirdAction(enabled) {
		this.isThirdActionDisabled = true;
	}

	@api async reinflate(scenarioId, shouldOverride) {
		this.isLoading = true;

		const quickPriceCalculator = {
			ACTION: 'LLC_BI.QuickPriceLoaderOrchestratorXPkg',
			ACTION_ARGS: {
				config: JSON.stringify(this.modalConfig),
				scenarioToClone: scenarioId,
			},
		};

		try {
			if (shouldOverride) {
				await this.cleanUpData();
			}
			let payload = await invoke({ params: quickPriceCalculator });
			this.parsePayload(payload);
			this.loadModal();
		} catch (e) {
			handleError(e);
		} finally {
			this.isLoading = false;
		}
	}

	constructor() {
		super();
		this.template.addEventListener(PRICING_FIELD_UPDATE_EVENT, (event) => this.handleUpdate(event));
		window.addEventListener('beforeunload', (_) => this.handleNavigateAway());
	}

	get topSection() {
		if (!this.modalController.length) return new Array();
		return this.modalController[0];
	}

	get bottomSection() {
		if (!this.modalController.length) return new Array();
		return this.modalController[this.modalController.length - 1];
	}

	async prepareConfig() {
		this.isLoading = true;

		const quickPriceCalculator = {
			ACTION: 'LLC_BI.QuickPriceLoaderOrchestratorXPkg',
			ACTION_ARGS: {
				config: null,
				scenarioToClone: null,
			},
		};

		try {
			let payload;
			if (sessionStorage.getItem('payload')) {
				payload = JSON.parse(sessionStorage.getItem('payload'));
			} else {
				payload = await invoke({ params: quickPriceCalculator });
			}
			this.parsePayload(payload);
		} catch (e) {
			handleError(e);
		}
	}

	async handleNavigateAway() {
		sessionStorage.clear();
		await this.cleanUpData();
	}

	handleUpdate(event) {
		try {
			let eventField = event.detail.field;
			const newValue = event.detail.value;

			this.setModalControllerFieldValue(eventField.guid, newValue);

			if (!eventField.dependentFieldGuids) return;
			for (const dependentGuid of eventField.dependentFieldGuids) {
				if (this.getIndexByGuid(dependentGuid)[0] === 'b') {
					this.updateDependentButtons(dependentGuid);
				}
			}
		} catch (e) {
			handleError(e);
		}
	}

	parsePayload(payload) {
		if (!payload) return;
		const result = JSON.parse(payload.results);
		sessionStorage.setItem('payload', JSON.stringify(payload));
		this.modalConfig = result;
		for (const section of result.sections) {
			this.modalController.push(section.fields);
		}
		if (result.children && result.children.length > 0) {
			this.fistBornChild = result.children[0];
		}
	}

	loadModal() {
		for (let i = 0; i < this.modalController.length; i++) {
			this.modalController[i].forEach((field) => {
				this.setModalControllerFieldValue(field.guid, field.value, true);
				if (!this.scenarioId || field.identity !== this.scenarioId) {
					this.scenarioId = field.identity;
				}
			});
		}
		this.isThirdActionDisabled = true;
		this.isLoading = false;
	}

	onCalculate() {
		try {
			this.buttonPressed('b-calcSuccess');
		} catch (e) {
			handleError(e);
		}
	}

	clearForm() {
		for (let i = 0; i < this.modalController.length; i++) {
			this.modalController[i].forEach((field) => {
				this.setModalControllerFieldValue(field.guid, null);
				field.previousValue = null;
			});
		}
	}

	async saveData() {
		this.isLoading = true;

		const quickPriceSaver = {
			ACTION: 'LLC_BI.QuickPriceSaverXpkg',
			ACTION_ARGS: {
				fieldsToSave: this.modalController.flat(),
			},
		};

		try {
			await invoke({ params: quickPriceSaver });
			this.dispatchEvent(new CustomEvent('savesuccess'));
			this.modalController = new Array();
			await this.reinflate(this.scenarioId, false);
		} catch (e) {
			handleError(e);
		}
		this.isLoading = false;
	}

	async cleanUpData() {
		const quickPriceRemover = {
			ACTION: 'LLC_BI.QuickPriceRemoverXpkg',
			ACTION_ARGS: {
				scenarioIds: [this.scenarioId],
			},
		};

		try {
			await invoke({ params: quickPriceRemover });
			this.modalController = new Array();
		} catch (e) {
			handleError(e);
		}
	}

	updateDependentField(changedGuid, fieldGuid, preventFormulaOverwrite, loopProtection) {
		if (!fieldGuid || !/[0-9]+/.test(this.getIndexByGuid(fieldGuid)[0])) return;
		let field = this.getFieldByGuid(fieldGuid);

		let selectedOption = this.getDependOptionInfo(changedGuid, field);
		if (!selectedOption) return;

		if (selectedOption.formula != null && !preventFormulaOverwrite) {
			this.setModalControllerFieldValue(
				fieldGuid,
				this.evaluateFormulaField(selectedOption.formula, fieldGuid),
				preventFormulaOverwrite,
				loopProtection
			);
		}

		if (selectedOption.disabled != null) {
			field.disabled = selectedOption.disabled;
		}
		if (selectedOption.hidden != null) {
			field.hidden = selectedOption.hidden;
		}
		if (selectedOption.readOnly != null) {
			field.readOnly = selectedOption.readOnly;
		}
		if (field.dataType.displayType === 'PICKLIST' && selectedOption.picklistOptions != null) {
			field.picklistOptions = selectedOption.picklistOptions;
		}
		if (!!field.value && field.dependentFieldGuids.indexOf('b-saveEnabled') > -1) {
			this.updateDependentButtons('b-saveEnabled');
		}
	}

	getDependOptionInfo(changedGuid, field) {
		if (
			!(
				field.dependentOptions &&
				(changedGuid in field.dependentOptions || '*' in field.dependentOptions)
			)
		) {
			return;
		}

		changedGuid = changedGuid in field.dependentOptions ? changedGuid : '*';
		const breakChar = ' -||- ';

		let splitControllingFields = new Array();
		if (field.controllerFieldGuids && field.controllerFieldGuids.length > 0) {
			field.controllerFieldGuids.forEach((guid) => {
				splitControllingFields.push(this.getFieldByGuid(guid).value);
			});
		}

		let selectedOption;
		for (let i = 0; !selectedOption; i++) {
			const reversedBinaryIndex = [
				...i.toString(2).padStart(splitControllingFields.length, '0'),
			].reverse();
			const controllingValues =
				splitControllingFields.length > 0
					? splitControllingFields
							.map((controllingFieldValue, j) => {
								if (reversedBinaryIndex[j] === '1') return '*';
								else return controllingFieldValue;
							})
							.join(breakChar)
							.toLowerCase()
					: '*';
			selectedOption = field.dependentOptions[changedGuid][controllingValues];
			if (i > splitControllingFields.length ** 2) {
				return;
			}
		}
		return selectedOption;
	}

	updateDependentButtons(guid) {
		this.isThirdActionDisabled =
			guid === 'b-saveDisabled' || (guid === 'b-saveEnabled' ? false : this.isThirdActionDisabled);
	}

	buttonPressed(guid) {
		const indicator = this.getIndexByGuid(guid)[0];

		for (let i = 0; i < this.modalController.length; i++) {
			for (const field of this.modalController[i]) {
				if (!field.dependentOptions) continue;

				if (guid in field.dependentOptions) {
					this.updateDependentField(guid, field.guid);
				} else if (indicator + '-*' in field.dependentOptions) {
					this.updateDependentField(indicator + '-*', field.guid);
				}
			}
		}
	}

	evaluateFormulaField(formula, fieldGuid) {
		const guids = formula.match(/(?<=\{)\w+-\w+(?=\})/g);
		let evaluatedFormula = formula;
		for (let i = 0; guids && i < guids.length; i++) {
			evaluatedFormula = evaluatedFormula.replace(
				/\{\w+-\w+\}/,
				this.getFieldByGuid(guids[i])[guids[i] === fieldGuid ? 'previousValue' : 'value']
			);
		}
		return eval(evaluatedFormula);
	}

	setModalControllerFieldValue(guid, value, preventFormulaOverwrite, loopProtection) {
		loopProtection = loopProtection || new Array();
		if (loopProtection.includes(guid)) return;
		loopProtection.push(guid);

		let field = this.getFieldByGuid(guid);

		switch (field.dataType.htmlType) {
			case 'datetime-local':
				value = new Date(value) || null;
				break;
			case 'number':
				value = Number(value) || null;
				break;
			case 'picklist':
				value = value ? value : '';
				break;
			case 'text':
				value = value || '';
				break;
			case 'toggle':
				value = Boolean(value) || false;
				break;
			default:
				value = value;
				break;
		}

		if (!field.hidden) {
			field.previousValue = field.value;
		}
		if (field.value != value || preventFormulaOverwrite) {
			field.value = value;
			if (!field.dependentFieldGuids || field.dependentFieldGuids.length === 0) {
				loopProtection = new Array();
				return;
			}
			for (const dependentGuid of field.dependentFieldGuids) {
				this.updateDependentField(guid, dependentGuid, preventFormulaOverwrite);
			}
		}
	}

	getFieldByGuid(guid) {
		const splitGuid = this.getIndexByGuid(guid);

		return this.modalController[splitGuid[0]][splitGuid[1]];
	}

	getIndexByGuid(guid) {
		return guid.split('-');
	}

	async connectedCallback() {
		await this.prepareConfig();
		this.loadModal();
	}
}
