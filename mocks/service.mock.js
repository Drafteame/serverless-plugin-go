export default class ServiceMock {
  constructor() {
    this.custom = {};
    this.functions = {};
    this.provider = {};
  }

  setFunctions(functions) {
    this.functions = functions;
    return this;
  }

  setCustom(custom) {
    this.custom = custom;
    return this;
  }

  setProvider(provider) {
    this.provider = provider;
    return this;
  }

  getAllFunctions() {
    return Object.keys(this.functions);
  }

  getFunction(name) {
    return this.functions[name];
  }

  restore() {
    this.custom = {};
    this.functions = {};
    this.provider = {};
  }
}
