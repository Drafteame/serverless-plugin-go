import sinon from "sinon";

import ServiceMock from "./service.mock.js";

export default class ServerlessMock {
  constructor() {
    this.service = new ServiceMock();

    this.cli = {
      consoleLog: sinon.stub(),
    };
  }

  getProvider() {
    return {};
  }
}
