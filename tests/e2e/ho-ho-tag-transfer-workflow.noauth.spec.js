const { registerTagTransferSuite } = require('./_tag-transfer-suite');

// HO -> HO: Kakkanad (head office) -> Aluva (head office)
registerTagTransferSuite({
  title: 'Tag Transfer - HO to HO (Kakkanad -> Aluva)',
  tc: 'TC-HHT',
  stateFile: 'e2e-tag-hh-state.json',
  sourceBU: 'Kakkanad',
  destinationBU: 'Aluva',
});
