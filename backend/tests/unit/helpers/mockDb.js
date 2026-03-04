const mockQuery = jest.fn();
const mockTransaction = jest.fn();

const db = {
  query: mockQuery,
  transaction: mockTransaction,
  healthCheck: jest.fn().mockResolvedValue({ ok: true, timestamp: new Date() }),
  pool: { end: jest.fn() },
};

// Helper to reset all mocks
db.resetMocks = () => {
  mockQuery.mockReset();
  mockTransaction.mockReset();
  db.healthCheck.mockReset().mockResolvedValue({ ok: true, timestamp: new Date() });
};

// Helper to setup transaction mock that executes the callback
db.setupTransaction = () => {
  const mockClient = {
    query: jest.fn(),
  };
  mockTransaction.mockImplementation(async (cb) => {
    return await cb(mockClient);
  });
  return mockClient;
};

module.exports = db;
