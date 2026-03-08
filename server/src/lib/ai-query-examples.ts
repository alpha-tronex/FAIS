/**
 * Example (question, query, result_summary) triples for RAG retrieval.
 * Used to augment the prompt so the LLM sees both query patterns and summary style.
 */

export type ExampleQuery =
  | { type: 'find'; collection: string; filter: Record<string, unknown>; projection?: Record<string, unknown>; limit?: number }
  | { type: 'aggregate'; collection: string; pipeline: Record<string, unknown>[] };

export type AiQueryExample = {
  question: string;
  query: ExampleQuery;
  result_summary: string;
};

export const AI_QUERY_EXAMPLES: AiQueryExample[] = [
  {
    question: 'List all petitioners',
    query: {
      type: 'find',
      collection: 'users',
      filter: { roleTypeId: 1 },
      projection: { uname: 1, firstName: 1, lastName: 1 },
      limit: 100,
    },
    result_summary: 'There are 12 petitioners. Names and usernames are listed in the results.',
  },
  {
    question: 'List all petitioner attorneys',
    query: {
      type: 'find',
      collection: 'users',
      filter: { roleTypeId: 3 },
      projection: { uname: 1, firstName: 1, lastName: 1 },
      limit: 100,
    },
    result_summary: 'There are 5 petitioner attorneys in the system.',
  },
  {
    question: 'Show cases in Broward county',
    query: {
      type: 'find',
      collection: 'case',
      filter: { countyId: 1 },
      limit: 200,
    },
    result_summary: 'There are 45 cases filed in Broward County. Case numbers and divisions are listed.',
  },
  {
    question: 'List case numbers involving stress-petitioner-1',
    query: {
      type: 'find',
      collection: 'case',
      filter: {
        $or: [
          { petitionerId: 'OBJECTID_PLACEHOLDER' },
          { respondentId: 'OBJECTID_PLACEHOLDER' },
          { petitionerAttId: 'OBJECTID_PLACEHOLDER' },
          { respondentAttId: 'OBJECTID_PLACEHOLDER' },
          { legalAssistantId: 'OBJECTID_PLACEHOLDER' },
        ],
      },
      projection: { caseNumber: 1, division: 1, _id: 1 },
      limit: 500,
    },
    result_summary: 'This user is involved in 2 cases: case numbers 2024-DR-001 and 2024-DR-002.',
  },
  {
    question: 'Employment information for stress-petitioner-1',
    query: {
      type: 'find',
      collection: 'employment',
      filter: { userId: 'OBJECTID_PLACEHOLDER' },
      limit: 50,
    },
    result_summary: 'Employment: McDonald\'s, Manager, $18/hour. One employer on file.',
  },
  {
    question: 'List monthly income for stress-petitioner-10',
    query: {
      type: 'find',
      collection: 'monthlyincome',
      filter: { userId: 'OBJECTID_PLACEHOLDER' },
      limit: 50,
    },
    result_summary: 'Monthly income: Wages $3,200; Child support received $500. Total from 2 sources.',
  },
  {
    question: 'Assets for stress-petitioner-5',
    query: {
      type: 'find',
      collection: 'assets',
      filter: { userId: 'OBJECTID_PLACEHOLDER' },
      limit: 50,
    },
    result_summary: 'Assets on file: 2018 Honda Civic, $12,000; Savings account, $5,200. Total market value $17,200.',
  },
  {
    question: 'What is the average income of affidavit clients?',
    query: {
      type: 'aggregate',
      collection: 'monthlyincome',
      pipeline: [{ $group: { _id: null, averageIncome: { $avg: '$amount' } } }],
    },
    result_summary: 'The average monthly income across all affidavit clients is $3,450.',
  },
  {
    question: 'List the petitioners with the highest income',
    query: {
      type: 'aggregate',
      collection: 'monthlyincome',
      pipeline: [
        { $group: { _id: '$userId', totalIncome: { $sum: '$amount' } } },
        { $sort: { totalIncome: -1 } },
        { $limit: 50 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'userDoc',
          },
        },
        { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: false } },
        { $match: { 'userDoc.roleTypeId': 1 } },
        { $project: { firstName: '$userDoc.firstName', lastName: '$userDoc.lastName', totalIncome: 1, _id: 0 } },
      ],
    },
    result_summary: 'Petitioners with highest total monthly income: Jane Doe ($5,200), John Smith ($4,800), Maria Garcia ($4,100).',
  },
  {
    question: 'Who has the least income in Broward county?',
    query: {
      type: 'aggregate',
      collection: 'monthlyincome',
      pipeline: [
        {
          $lookup: {
            from: 'case',
            let: { userId: '$userId' },
            pipeline: [
              {
                $match: {
                  $and: [
                    { $expr: { $or: [{ $eq: ['$petitionerId', '$$userId'] }, { $eq: ['$respondentId', '$$userId'] }] } },
                    { countyId: 2 },
                  ],
                },
              },
              { $limit: 1 },
            ],
            as: 'userCase',
          },
        },
        { $unwind: { path: '$userCase', preserveNullAndEmptyArrays: false } },
        { $group: { _id: '$userId', totalIncome: { $sum: '$amount' } } },
        { $sort: { totalIncome: 1 } },
        { $limit: 1 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'userDoc',
          },
        },
        { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: false } },
        { $project: { firstName: '$userDoc.firstName', lastName: '$userDoc.lastName', totalIncome: 1, _id: 0 } },
      ],
    },
    result_summary: 'In Broward county the person with the least total monthly income is Petitioner Stress1 ($2,500).',
  },
  {
    question: 'List upcoming appointments',
    query: {
      type: 'find',
      collection: 'appointments',
      filter: { scheduledAt: { $gte: 'NOW_ISO' }, status: { $nin: ['cancelled', 'rejected'] } },
      projection: { scheduledAt: 1, durationMinutes: 1, status: 1 },
      limit: 50,
    },
    result_summary: 'There are 8 upcoming appointments in the next 30 days. Dates and status are listed.',
  },
  {
    question: 'Which counties have the most liabilities?',
    query: {
      type: 'aggregate',
      collection: 'liabilities',
      pipeline: [
        {
          $lookup: {
            from: 'case',
            let: { userId: '$userId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ['$petitionerId', '$$userId'] },
                      { $eq: ['$respondentId', '$$userId'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'userCase',
          },
        },
        { $unwind: { path: '$userCase', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: '$userCase.countyId',
            totalLiabilities: { $sum: 1 },
            totalAmount: { $sum: '$amountOwed' },
            items: { $push: { description: '$description', amount: '$amountOwed' } },
          },
        },
        { $match: { _id: { $ne: null } } },
        { $sort: { totalAmount: -1 } },
        { $limit: 50 },
        { $project: { _id: 1, totalLiabilities: 1, totalAmount: 1, items: { $slice: ['$items', 10] } } },
      ],
    },
    result_summary: 'Broward County has the most liabilities (142, $1.2M total): Credit card $500, Mortgage $200,000, …',
  },
  {
    question: 'Which counties have the most assets?',
    query: {
      type: 'aggregate',
      collection: 'assets',
      pipeline: [
        {
          $lookup: {
            from: 'case',
            let: { userId: '$userId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ['$petitionerId', '$$userId'] },
                      { $eq: ['$respondentId', '$$userId'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'userCase',
          },
        },
        { $unwind: { path: '$userCase', preserveNullAndEmptyArrays: false } },
        { $group: { _id: '$userCase.countyId', totalAssets: { $sum: 1 }, totalValue: { $sum: '$marketValue' } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { totalAssets: -1 } },
        { $limit: 50 },
      ],
    },
    result_summary: 'Broward County has the most asset records (89), followed by Miami-Dade (62).',
  },
  {
    question: 'Which counties have the highest average income?',
    query: {
      type: 'aggregate',
      collection: 'monthlyincome',
      pipeline: [
        {
          $lookup: {
            from: 'lookup_monthly_income_types',
            let: { typeId: '$typeId' },
            pipeline: [{ $match: { $expr: { $eq: ['$id', '$$typeId'] } } }, { $limit: 1 }],
            as: 'incomeTypeDoc',
          },
        },
        { $unwind: { path: '$incomeTypeDoc', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'case',
            let: { userId: '$userId' },
            pipeline: [
              { $match: { $expr: { $or: [{ $eq: ['$petitionerId', '$$userId'] }, { $eq: ['$respondentId', '$$userId'] }] } } },
              { $limit: 1 },
            ],
            as: 'userCase',
          },
        },
        { $unwind: { path: '$userCase', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: '$userCase.countyId',
            avgIncome: { $avg: '$amount' },
            totalIncome: { $sum: '$amount' },
            items: { $push: { typeName: '$incomeTypeDoc.name', amount: '$amount' } },
          },
        },
        { $match: { _id: { $ne: null } } },
        { $sort: { avgIncome: -1 } },
        { $limit: 50 },
        { $project: { _id: 1, avgIncome: 1, totalIncome: 1, items: { $slice: ['$items', 10] } } },
      ],
    },
    result_summary: 'Broward County has the highest average monthly income ($4,200): Wages $3,200, Child support $500, …',
  },
  {
    question: 'Which 3 counties have the highest income?',
    query: {
      type: 'aggregate',
      collection: 'monthlyincome',
      pipeline: [
        {
          $lookup: {
            from: 'lookup_monthly_income_types',
            let: { typeId: '$typeId' },
            pipeline: [{ $match: { $expr: { $eq: ['$id', '$$typeId'] } } }, { $limit: 1 }],
            as: 'incomeTypeDoc',
          },
        },
        { $unwind: { path: '$incomeTypeDoc', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'case',
            let: { userId: '$userId' },
            pipeline: [
              { $match: { $expr: { $or: [{ $eq: ['$petitionerId', '$$userId'] }, { $eq: ['$respondentId', '$$userId'] }] } } },
              { $limit: 1 },
            ],
            as: 'userCase',
          },
        },
        { $unwind: { path: '$userCase', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: '$userCase.countyId',
            avgIncome: { $avg: '$amount' },
            totalIncome: { $sum: '$amount' },
            items: { $push: { typeName: '$incomeTypeDoc.name', amount: '$amount' } },
          },
        },
        { $match: { _id: { $ne: null } } },
        { $sort: { avgIncome: -1 } },
        { $limit: 3 },
        { $project: { _id: 1, avgIncome: 1, totalIncome: 1, items: { $slice: ['$items', 10] } } },
      ],
    },
    result_summary: 'The 3 counties with the highest average income: Broward ($4,200 — Wages $3,200, Child support $500), Palm Beach ($3,800), Miami-Dade ($3,500).',
  },
  {
    question: 'List top 3 counties with highest income',
    query: {
      type: 'aggregate',
      collection: 'monthlyincome',
      pipeline: [
        {
          $lookup: {
            from: 'lookup_monthly_income_types',
            let: { typeId: '$typeId' },
            pipeline: [{ $match: { $expr: { $eq: ['$id', '$$typeId'] } } }, { $limit: 1 }],
            as: 'incomeTypeDoc',
          },
        },
        { $unwind: { path: '$incomeTypeDoc', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'case',
            let: { userId: '$userId' },
            pipeline: [
              { $match: { $expr: { $or: [{ $eq: ['$petitionerId', '$$userId'] }, { $eq: ['$respondentId', '$$userId'] }] } } },
              { $limit: 1 },
            ],
            as: 'userCase',
          },
        },
        { $unwind: { path: '$userCase', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: '$userCase.countyId',
            avgIncome: { $avg: '$amount' },
            totalIncome: { $sum: '$amount' },
            items: { $push: { typeName: '$incomeTypeDoc.name', amount: '$amount' } },
          },
        },
        { $match: { _id: { $ne: null } } },
        { $sort: { avgIncome: -1 } },
        { $limit: 3 },
        { $project: { _id: 1, avgIncome: 1, totalIncome: 1, items: { $slice: ['$items', 10] } } },
      ],
    },
    result_summary: 'Top 3 counties by average income: Broward ($4,200 — Wages $3,200, Child support $500), Palm Beach ($3,800), Miami-Dade ($3,500).',
  },
  {
    question: 'List top 3 counties with most assets',
    query: {
      type: 'aggregate',
      collection: 'assets',
      pipeline: [
        {
          $lookup: {
            from: 'case',
            let: { userId: '$userId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ['$petitionerId', '$$userId'] },
                      { $eq: ['$respondentId', '$$userId'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'userCase',
          },
        },
        { $unwind: { path: '$userCase', preserveNullAndEmptyArrays: false } },
        { $group: { _id: '$userCase.countyId', totalAssets: { $sum: 1 }, totalValue: { $sum: '$marketValue' } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { totalAssets: -1 } },
        { $limit: 3 },
      ],
    },
    result_summary: 'Top 3 counties by asset count: Broward (89 assets), Miami-Dade (62), Palm Beach (51).',
  },
  {
    question: 'List top 3 counties with most liabilities',
    query: {
      type: 'aggregate',
      collection: 'liabilities',
      pipeline: [
        {
          $lookup: {
            from: 'case',
            let: { userId: '$userId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ['$petitionerId', '$$userId'] },
                      { $eq: ['$respondentId', '$$userId'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'userCase',
          },
        },
        { $unwind: { path: '$userCase', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: '$userCase.countyId',
            totalLiabilities: { $sum: 1 },
            totalAmount: { $sum: '$amountOwed' },
            items: { $push: { description: '$description', amount: '$amountOwed' } },
          },
        },
        { $match: { _id: { $ne: null } } },
        { $sort: { totalAmount: -1 } },
        { $limit: 3 },
        { $project: { _id: 1, totalLiabilities: 1, totalAmount: 1, items: { $slice: ['$items', 10] } } },
      ],
    },
    result_summary: 'Top 3 counties by total liabilities: Broward 142 liabilities, $1.2M total (Credit card $500, Bank loan $2,000, ...).',
  },
  {
    question: 'List the 3 counties with the highest amount of liabilities',
    query: {
      type: 'aggregate',
      collection: 'liabilities',
      pipeline: [
        {
          $lookup: {
            from: 'case',
            let: { userId: '$userId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ['$petitionerId', '$$userId'] },
                      { $eq: ['$respondentId', '$$userId'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'userCase',
          },
        },
        { $unwind: { path: '$userCase', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: '$userCase.countyId',
            totalLiabilities: { $sum: 1 },
            totalAmount: { $sum: '$amountOwed' },
            items: { $push: { description: '$description', amount: '$amountOwed' } },
          },
        },
        { $match: { _id: { $ne: null } } },
        { $sort: { totalAmount: -1 } },
        { $limit: 3 },
        { $project: { _id: 1, totalLiabilities: 1, totalAmount: 1, items: { $slice: ['$items', 10] } } },
      ],
    },
    result_summary: 'The 3 counties with the highest total liability amounts: Broward ($1.2M total, 142 items: Credit card $500, Mortgage $200,000, ...), Miami-Dade ($980K), Palm Beach ($750K).',
  },
  {
    question: 'List top 3 counties with most employment',
    query: {
      type: 'aggregate',
      collection: 'employment',
      pipeline: [
        {
          $lookup: {
            from: 'case',
            let: { userId: '$userId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ['$petitionerId', '$$userId'] },
                      { $eq: ['$respondentId', '$$userId'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'userCase',
          },
        },
        { $unwind: { path: '$userCase', preserveNullAndEmptyArrays: false } },
        { $group: { _id: '$userCase.countyId', totalEmployment: { $sum: 1 } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { totalEmployment: -1 } },
        { $limit: 3 },
      ],
    },
    result_summary: 'Top 3 counties by employment records: Broward (156), Miami-Dade (98), Palm Beach (72).',
  },
  {
    question: 'Which counties have the most employment records?',
    query: {
      type: 'aggregate',
      collection: 'employment',
      pipeline: [
        {
          $lookup: {
            from: 'case',
            let: { userId: '$userId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ['$petitionerId', '$$userId'] },
                      { $eq: ['$respondentId', '$$userId'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'userCase',
          },
        },
        { $unwind: { path: '$userCase', preserveNullAndEmptyArrays: false } },
        { $group: { _id: '$userCase.countyId', totalEmployment: { $sum: 1 } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { totalEmployment: -1 } },
        { $limit: 50 },
      ],
    },
    result_summary: 'Broward County has the most employment records (156), followed by Miami-Dade (98).',
  },
];
