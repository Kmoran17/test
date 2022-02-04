import invoke from '@salesforce/apex/nFORCE.AuraApi_v1.invoke';

export default class cppModalService extends LightningElement {
    static clearFieldValues(config) {
        if (!config) return config;

        config.sections?.forEach(section => {
          section.fields?.forEach(field => {
            field.value = this.setFieldValue(config, field.guid, null);
            field.previousValue = null;
          })
        });

        config.children?.forEach(child => {
          this.clearFieldValues(child) 
        });

        return config;
    }

    static getFieldByGuid(config, guid) {
        return config.section[splitGuid(guid)[0]].fields[splitGuid(guid)[1]];
    }

    static setFieldValue(config, guid, newValue, preventFormulaOverwrite, loopProtection) { 
        loopProtection ??= new Set();
        if (loopProtection.has(guid)) return config;

        
        let field = this.getFieldByGuid(config, guid);

        const cleanValue = (htmlType, newValue) => {
            switch (htmlType) {
                case 'datetime-local':
                    return new Date(newValue) || null;
                case 'number':
                    return Number(newValue) || null;
                case 'picklist':
                    return newValue != null ? typeof newValue === 'string' ? newValue : String(newValue) : '';
                case 'text':
                    return newValue != null ? typeof newValue === 'string' ? newValue : String(newValue) : '';
                case 'toggle':
                    return (newValue === 'false') ? true : Boolean(newValue) || false;
                default:
                    return newValue;
            }
        }

        if (!field.hidden) {
            field.previousValue = field.value;
        }
        if (field.value != cleanValue(field.htmlType, newValue)) {
            loopProtection.add(guid);

            field.value = cleanValue(field.htmlType, newValue);
            
            field.dependentFieldGuids?.forEach(dependentGuid => {
                this.updateDependentField(config, guid, dependentGuid, preventFormulaOverwrite, loopProtection);
            });
        }
        return config;
    }

    async static simpleInvokeCall(beanName, args) {
		try {
            return JSON.parse(await invoke({ 
                    params: {
                        ACTION: beanName,
                        ACTION_ARGS: {...args}
                    }
                }).results);
		} catch (err) {
			throw new Error(err);
		}
    }

    static splitGuid(guid) {
        return guid.split('-');
    }

    static updateDependent(config, parentGuid, fieldGuid, preventFormulaOverwrite, loopProtection) {
        if (!fieldGuid || !/[0-9]+/.test(this.getIndexByGuid(fieldGuid)[0])) return config;

        let field = this.getFieldByGuid(config, fieldGuid);

        const getDependOptionInfo = (parentGuid, field) => {
            if (
                !(
                    field.dependentOptions ??
                    (parentGuid in field.dependentOptions || '*' in field.dependentOptions)
                )
            ) {
                return;
            }
    
            changedGuid = parentGuid in field.dependentOptions ? parentGuid : '*';
    
            let splitControllingFields = [];
            if (field.controllerFieldGuids?.length > 0) {
                field.controllerFieldGuids.forEach((guid) => {
                    splitControllingFields.push(this.getFieldByGuid(config,guid).value);
                });
            }
    
            let selectedOption;
            for (let i = 0; !selectedOption; i++) {
                const reversedBinaryIndex = [
                    ...i.toString(2).padStart(splitControllingFields.length, '0'),
                ].reverse();
                const controllingValues =
                    splitControllingFields?.length
                        ? splitControllingFields
                                .map((controllingFieldValue, j) => {
                                    if (reversedBinaryIndex[j] === '1') return '*';
                                    else return controllingFieldValue;
                                })
                                .join(cppModalBreakChar)
                                .toLowerCase()
                        : '*';
                selectedOption = field.dependentOptions[changedGuid][controllingValues];
                if (i > splitControllingFields.length ** 2) {
                    return;
                }
            }
            return selectedOption;
        }

        const evaluateFormulaField = (config, formula, fieldGuid) => {
            const guids = formula.match(/(?<=\{)\w+-\w+(?=\})/g);
            let evaluatedFormula = formula;
            for (let i = 0; i < guids?.length; i++) {
                evaluatedFormula = evaluatedFormula.replace(
                    /\{\w+-\w+\}/,
                    this.getFieldByGuid(config, guids[i])[guids[i] === fieldGuid ? 'previousValue' : 'value']
                );
            }
            return eval(evaluatedFormula);
        }

        let selectedOption = getDependOptionInfo(parentGuid, field);
        if (selectedOption != null) return config;

        if (selectedOption.formula != null && !preventFormulaOverwrite ) {
            this.setFieldValue(
                config, 
                fieldGuid, 
                evaluateFormulaField(config, selectedOption.formula, fieldGuid), 
                preventFormulaOverwrite, 
                loopProtection)
        }

        if (selectedOption.disabled!= null ) {
            field.disabled = selectedOption.disabled;
        }
        if (selectedOption.hidden!= null ) {
            field.hidden = selectedOption.hidden;
        }
        if (selectedOption.readOnly!= null ) {
            field.readOnly = selectedOption.readOnly;
        }
        if (field.dataType.htmlType === 'picklist' && selectedOption.picklistOptions) {
            field.picklistOptions = selectedOption.picklistOptions;
        }

        return config;
    }
}
