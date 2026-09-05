/**
 * Process & Sub-Process seed data — transcribed verbatim from the QA lead's
 * three Excel exports (05-Sep-2026):
 *   - DepartmentProcess 3_47_30           -> PROCESSES (10 rows)
 *   - Department Sub Process 3_49_29      -> SUB_PROCESSES (43 rows, the full set)
 *
 * Material triples are coded (MO/MS/SO/NM) and expanded via MAT below, exactly
 * matching the live dropdown option text. Process Type is empty for every
 * process except Design And CAD ("CAD"). Sub-process material options are
 * filtered by the parent process, so each sub keeps its own triple.
 *
 * The sub-process "Burnout" points at parent "Casting" which is NOT in the
 * process sheet (the process is "Casting Process") - the spec SKIPS any
 * sub-process whose parent is not among PROCESSES (QA lead: "for mismatching
 * sub processes skip those").
 */

// material triples -> [issue, receipt, clearance] (exact dropdown labels)
const MAT = {
  MO: ['Metal Only', 'Metal Only', 'Metal Clearance'],
  MS: ['Metal & Stone', 'Metal & Stone', 'Metal & Stone Clearance'],
  SO: ['Stone Only', 'Stone Only', 'Stone Clearance'],
  NM: ['No Material Issued', 'No Material Received', 'No Material Clearance'],
};
const mat = (code) => ({ materialIssue: MAT[code][0], materialReceipt: MAT[code][1], materialClearance: MAT[code][2] });

const PROCESSES = [
  { name: 'Quality Control And Finishing', shortName: 'QF', ...mat('MS') },
  { name: 'Plating And Finishing', shortName: 'PF', ...mat('MO') },
  { name: 'Polishing Process', shortName: 'P', ...mat('MO') },
  { name: 'Stone Setting', shortName: 'Ss', ...mat('SO') },
  { name: 'Soldering', shortName: 'S', ...mat('MO') },
  { name: 'Filling And Grinding', shortName: 'FG', ...mat('MO') },
  { name: 'Tree Making', shortName: 'TM', ...mat('MO') },
  { name: 'Casting Process', shortName: 'C', ...mat('MO') },
  { name: 'Wax Production', shortName: 'Wp', ...mat('MS') },
  { name: 'Design And CAD', shortName: 'DC', ...mat('NM'), processType: 'CAD' },
];

// process (parent) -> its sub-processes. Order/values verbatim from the sheet.
const SUB_PROCESSES = [
  { name: 'Tree Inspection', shortName: 'Ti', process: 'Tree Making', ...mat('MO') },
  { name: 'Tree Formation', shortName: 'Tf', process: 'Tree Making', ...mat('MO') },
  { name: 'Wax Assembly', shortName: 'Wa', process: 'Tree Making', ...mat('MO') },
  { name: 'Sprue Preparation', shortName: 'Sp', process: 'Tree Making', ...mat('MO') },

  { name: 'Production Completion', shortName: 'Pc', process: 'Quality Control And Finishing', ...mat('MS') },
  { name: 'Final Qc', shortName: 'Fq', process: 'Quality Control And Finishing', ...mat('MS') },
  { name: 'Hallmarking', shortName: 'Hl', process: 'Quality Control And Finishing', ...mat('MS') },
  { name: 'Dimension Check', shortName: 'Dc', process: 'Quality Control And Finishing', ...mat('MS') },
  { name: 'Stone Verification', shortName: 'Sv', process: 'Quality Control And Finishing', ...mat('MS') },
  { name: 'Weight Verification', shortName: 'Wv', process: 'Quality Control And Finishing', ...mat('MS') },

  { name: 'Final Inspection', shortName: 'Fi', process: 'Plating And Finishing', ...mat('MO') },
  { name: 'Colour Finishing', shortName: 'Cl', process: 'Plating And Finishing', ...mat('MO') },
  { name: 'Gold Plating', shortName: 'Gp', process: 'Plating And Finishing', ...mat('MO') },
  { name: 'Rhodium Plating', shortName: 'Rp', process: 'Plating And Finishing', ...mat('MO') },
  { name: 'Surface Cleaning', shortName: 'Sc', process: 'Plating And Finishing', ...mat('MO') },

  { name: 'Polish Inspection', shortName: 'Pi', process: 'Polishing Process', ...mat('MO') },
  { name: 'Final Polishing', shortName: 'Fp', process: 'Polishing Process', ...mat('MO') },
  { name: 'Buffing', shortName: 'B', process: 'Polishing Process', ...mat('MO') },
  { name: 'Pre Polishing', shortName: 'Pp', process: 'Polishing Process', ...mat('MO') },

  { name: 'Stone Setting Inspection', shortName: 'Ssi', process: 'Stone Setting', ...mat('SO') },
  { name: 'Stone Issue', shortName: 'Si', process: 'Stone Setting', ...mat('SO') },
  { name: 'Stone Sorting', shortName: 'Ss', process: 'Stone Setting', ...mat('SO') },

  { name: 'Soldering Inspection', shortName: 'SI', process: 'Soldering', ...mat('MO') },
  { name: 'Laser Soldering', shortName: 'Ls', process: 'Soldering', ...mat('MO') },
  { name: 'Joint Soldering', shortName: 'Js', process: 'Soldering', ...mat('MO') },
  { name: 'Component Assembly', shortName: 'Ca', process: 'Soldering', ...mat('MO') },

  { name: 'Shape Correction', shortName: 'Scc', process: 'Filling And Grinding', ...mat('MO') },
  { name: 'Surface Cleaning', shortName: 'Sc', process: 'Filling And Grinding', ...mat('MO') },
  { name: 'Grinding', shortName: 'G', process: 'Filling And Grinding', ...mat('MO') },
  { name: 'Filling', shortName: 'F', process: 'Filling And Grinding', ...mat('MO') },

  { name: 'Casting Inspection', shortName: 'Ci', process: 'Casting Process', ...mat('MO') },
  { name: 'Metal Casting', shortName: 'Mc', process: 'Casting Process', ...mat('MO') },
  { name: 'Investment', shortName: 'I', process: 'Casting Process', ...mat('MO') },
  // Burnout -> "Casting" (not "Casting Process") - parent mismatch, SKIPPED by the spec
  { name: 'Burnout', shortName: 'B', process: 'Casting', ...mat('MS') },

  { name: 'Casting Preparation', shortName: 'Cp', process: 'Wax Production', ...mat('MS') },
  { name: 'Wax Rework', shortName: 'Wr', process: 'Wax Production', ...mat('MS') },
  { name: 'Wax Inspection', shortName: 'Wi', process: 'Wax Production', ...mat('MS') },
  { name: 'Wax Tree Making', shortName: 'Wm', process: 'Wax Production', ...mat('MS') },
  { name: 'Wax Printing', shortName: 'Wp', process: 'Wax Production', ...mat('MS') },

  { name: 'CAD Approval', shortName: 'Ca', process: 'Design And CAD', ...mat('NM') },
  { name: 'Design Modification', shortName: 'Dm', process: 'Design And CAD', ...mat('NM') },
  { name: 'CAD Modeling', shortName: 'Cm', process: 'Design And CAD', ...mat('NM') },
  { name: 'Design Creation', shortName: 'DC', process: 'Design And CAD', ...mat('NM') },
];

const DEPARTMENT = 'Production';
const LOCATION = 'Cochin';

module.exports = { PROCESSES, SUB_PROCESSES, DEPARTMENT, LOCATION };
