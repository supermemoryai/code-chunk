import { describe, expect, test } from 'bun:test'
import { type Chunk, chunk, chunkStream, type Language } from '../src'

// ============================================================================
// Integration Tests - End-to-End Flow for All Supported Languages
// ============================================================================

describe('integration: TypeScript', () => {
	test('full pipeline with class, methods, imports, and docstrings', async () => {
		const code = `import { Database } from './db'
import { Logger } from './utils'

/**
 * Service for managing user accounts.
 * Handles CRUD operations and authentication.
 */
export class UserService {
  private db: Database
  private logger: Logger

  constructor(db: Database, logger: Logger) {
    this.db = db
    this.logger = logger
  }

  /**
   * Fetch a user by their unique ID.
   * @param id - The user's unique identifier
   * @returns The user object or null if not found
   */
  async getUser(id: string): Promise<User | null> {
    this.logger.info(\`Fetching user: \${id}\`)
    return this.db.query('SELECT * FROM users WHERE id = ?', [id])
  }

  /**
   * Create a new user account.
   * @param data - The user data to insert
   * @returns The created user with generated ID
   */
  async createUser(data: CreateUserInput): Promise<User> {
    this.logger.info('Creating new user')
    const result = await this.db.insert('users', data)
    return { id: result.insertId, ...data }
  }

  /**
   * Delete a user by ID.
   * @param id - The user's unique identifier
   */
  async deleteUser(id: string): Promise<void> {
    this.logger.warn(\`Deleting user: \${id}\`)
    await this.db.delete('users', { id })
  }
}

/**
 * Helper function to validate user input.
 */
function validateUserInput(input: unknown): input is CreateUserInput {
  return typeof input === 'object' && input !== null && 'email' in input
}`

		const filepath = 'services/user.ts'
		const chunks = await chunk(filepath, code, {
			maxChunkSize: 500,
			siblingDetail: 'signatures',
			filterImports: true,
		})

		// Validate basic structure
		expect(chunks.length).toBeGreaterThan(1)
		expect(chunks.length).toBeLessThanOrEqual(10)

		// All chunks have correct metadata
		for (const c of chunks) {
			expect(c.context.filepath).toBe(filepath)
			expect(c.context.language).toBe('typescript')
		}

		// UserService class is detected
		const hasUserService = chunks.some(
			(c) =>
				c.context.entities.some((e) => e.name === 'UserService') ||
				c.context.scope.some((s) => s.name === 'UserService'),
		)
		expect(hasUserService).toBe(true)

		// Methods are detected
		const allEntities = chunks.flatMap((c) => c.context.entities)
		const methodNames = allEntities
			.filter((e) => e.type === 'method')
			.map((e) => e.name)
		expect(methodNames).toContain('getUser')
		expect(methodNames).toContain('createUser')
		expect(methodNames).toContain('deleteUser')

		// Imports are captured
		const allImports = chunks.flatMap((c) => c.context.imports)
		expect(allImports.length).toBeGreaterThan(0)

		// Chunks don't overlap
		const sortedChunks = [...chunks].sort(
			(a, b) => a.byteRange.start - b.byteRange.start,
		)
		let lastEnd = sortedChunks[0]?.byteRange.start ?? 0
		for (const c of sortedChunks) {
			expect(c.byteRange.start).toBeGreaterThanOrEqual(lastEnd)
			lastEnd = c.byteRange.end
		}

		// Text matches byte range
		for (const c of chunks) {
			const sliced = code.slice(c.byteRange.start, c.byteRange.end)
			expect(c.text).toBe(sliced)
		}
	})

	test('interface and type alias extraction', async () => {
		const code = `interface User {
  id: string
  name: string
  email: string
}

type UserRole = 'admin' | 'user' | 'guest'

interface UserWithRole extends User {
  role: UserRole
}

function createUser(data: Omit<User, 'id'>): User {
  return { ...data, id: crypto.randomUUID() }
}`

		const chunks = await chunk('types.ts', code)

		expect(chunks.length).toBeGreaterThan(0)

		const allEntities = chunks.flatMap((c) => c.context.entities)
		const entityNames = allEntities.map((e) => e.name)

		expect(entityNames).toContain('User')
		expect(entityNames).toContain('UserWithRole')
		expect(entityNames).toContain('createUser')

		// Verify interface type
		const userInterface = allEntities.find((e) => e.name === 'User')
		expect(userInterface?.type).toBe('interface')
	})

	test('arrow functions and const declarations', async () => {
		const code = `const add = (a: number, b: number): number => a + b

const multiply = (a: number, b: number): number => {
  return a * b
}

const API_URL = 'https://api.example.com'

export const fetchData = async <T>(endpoint: string): Promise<T> => {
  const response = await fetch(\`\${API_URL}/\${endpoint}\`)
  return response.json()
}`

		const chunks = await chunk('utils.ts', code)

		expect(chunks.length).toBeGreaterThan(0)

		// Verify text reconstruction
		for (const c of chunks) {
			const sliced = code.slice(c.byteRange.start, c.byteRange.end)
			expect(c.text).toBe(sliced)
		}
	})
})

describe('integration: JavaScript', () => {
	test('full pipeline with class, methods, and JSDoc', async () => {
		const code = `import { EventEmitter } from 'events'

/**
 * A simple event-driven calculator.
 * @extends EventEmitter
 */
class Calculator extends EventEmitter {
  constructor() {
    super()
    this.result = 0
  }

  /**
   * Add a number to the result.
   * @param {number} n - The number to add
   * @returns {number} The new result
   */
  add(n) {
    this.result += n
    this.emit('change', this.result)
    return this.result
  }

  /**
   * Subtract a number from the result.
   * @param {number} n - The number to subtract
   * @returns {number} The new result
   */
  subtract(n) {
    this.result -= n
    this.emit('change', this.result)
    return this.result
  }

  /**
   * Reset the calculator.
   */
  reset() {
    this.result = 0
    this.emit('reset')
  }
}

module.exports = { Calculator }`

		const chunks = await chunk('calculator.js', code)

		expect(chunks.length).toBeGreaterThan(0)

		// All chunks have correct metadata
		for (const c of chunks) {
			expect(c.context.language).toBe('javascript')
		}

		// Class and methods detected
		const allEntities = chunks.flatMap((c) => c.context.entities)
		const entityNames = allEntities.map((e) => e.name)

		expect(entityNames).toContain('Calculator')

		const methods = allEntities.filter((e) => e.type === 'method')
		expect(methods.map((m) => m.name)).toContain('add')
		expect(methods.map((m) => m.name)).toContain('subtract')
		expect(methods.map((m) => m.name)).toContain('reset')

		// Text matches byte range
		for (const c of chunks) {
			const sliced = code.slice(c.byteRange.start, c.byteRange.end)
			expect(c.text).toBe(sliced)
		}
	})

	test('ES modules with default and named exports', async () => {
		const code = `export const VERSION = '1.0.0'

export function greet(name) {
  return \`Hello, \${name}!\`
}

export default class App {
  constructor(config) {
    this.config = config
  }

  start() {
    console.log('App started')
  }
}`

		const chunks = await chunk('app.js', code)

		expect(chunks.length).toBeGreaterThan(0)

		const allEntities = chunks.flatMap((c) => c.context.entities)
		const entityNames = allEntities.map((e) => e.name)

		expect(entityNames).toContain('greet')
		expect(entityNames).toContain('App')
	})
})

describe('integration: Python', () => {
	test('full pipeline with class, methods, and docstrings', async () => {
		const code = `from typing import Optional, List
from dataclasses import dataclass

@dataclass
class User:
    """Represents a user in the system."""
    id: int
    name: str
    email: str

class UserRepository:
    """Repository for managing user data."""
    
    def __init__(self, db_connection):
        """Initialize the repository with a database connection.
        
        Args:
            db_connection: The database connection to use.
        """
        self.db = db_connection
        self._cache = {}
    
    def get_user(self, user_id: int) -> Optional[User]:
        """Fetch a user by ID.
        
        Args:
            user_id: The unique identifier of the user.
            
        Returns:
            The User object if found, None otherwise.
        """
        if user_id in self._cache:
            return self._cache[user_id]
        return self.db.query(User, user_id)
    
    def get_all_users(self) -> List[User]:
        """Fetch all users from the database.
        
        Returns:
            A list of all User objects.
        """
        return self.db.query_all(User)
    
    def save_user(self, user: User) -> None:
        """Save a user to the database.
        
        Args:
            user: The User object to save.
        """
        self.db.save(user)
        self._cache[user.id] = user


def create_default_user() -> User:
    """Create a default user for testing."""
    return User(id=0, name="Default", email="default@example.com")`

		const chunks = await chunk('repository.py', code)

		expect(chunks.length).toBeGreaterThan(0)

		// All chunks have correct metadata
		for (const c of chunks) {
			expect(c.context.language).toBe('python')
		}

		// Classes detected
		const allEntities = chunks.flatMap((c) => c.context.entities)
		const classNames = allEntities
			.filter((e) => e.type === 'class')
			.map((e) => e.name)
		expect(classNames).toContain('User')
		expect(classNames).toContain('UserRepository')

		// Methods detected (Python extracts methods as 'function' type)
		const pythonFunctions = allEntities.filter((e) => e.type === 'function')
		const functionNames = pythonFunctions.map((f) => f.name)
		expect(functionNames).toContain('__init__')
		expect(functionNames).toContain('get_user')
		expect(functionNames).toContain('get_all_users')
		expect(functionNames).toContain('save_user')

		// Standalone function also detected
		expect(functionNames).toContain('create_default_user')

		// Text matches byte range
		for (const c of chunks) {
			const sliced = code.slice(c.byteRange.start, c.byteRange.end)
			expect(c.text).toBe(sliced)
		}
	})

	test('async functions and decorators', async () => {
		const code = `import asyncio
from functools import lru_cache

@lru_cache(maxsize=100)
def fibonacci(n: int) -> int:
    """Calculate the nth Fibonacci number with caching."""
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

async def fetch_data(url: str) -> dict:
    """Fetch data from a URL asynchronously."""
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()

async def main():
    """Main entry point."""
    data = await fetch_data("https://api.example.com/data")
    print(data)`

		const chunks = await chunk('async_utils.py', code)

		expect(chunks.length).toBeGreaterThan(0)

		const allEntities = chunks.flatMap((c) => c.context.entities)
		const functionNames = allEntities
			.filter((e) => e.type === 'function')
			.map((e) => e.name)

		expect(functionNames).toContain('fibonacci')
		expect(functionNames).toContain('fetch_data')
		expect(functionNames).toContain('main')
	})
})

describe('integration: Rust', () => {
	test('full pipeline with struct, impl, and traits', async () => {
		const code = `use std::collections::HashMap;
use std::fmt;

/// A simple key-value store.
#[derive(Debug, Clone)]
pub struct Store<T> {
    data: HashMap<String, T>,
    name: String,
}

impl<T: Clone> Store<T> {
    /// Create a new empty store.
    pub fn new(name: &str) -> Self {
        Store {
            data: HashMap::new(),
            name: name.to_string(),
        }
    }

    /// Get a value by key.
    pub fn get(&self, key: &str) -> Option<&T> {
        self.data.get(key)
    }

    /// Set a value for a key.
    pub fn set(&mut self, key: String, value: T) {
        self.data.insert(key, value);
    }

    /// Remove a value by key.
    pub fn remove(&mut self, key: &str) -> Option<T> {
        self.data.remove(key)
    }

    /// Get the number of items in the store.
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Check if the store is empty.
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

impl<T: fmt::Display> fmt::Display for Store<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Store '{}' with {} items", self.name, self.data.len())
    }
}

/// A helper function to create a store with initial values.
pub fn create_store_with<T: Clone>(name: &str, items: Vec<(String, T)>) -> Store<T> {
    let mut store = Store::new(name);
    for (key, value) in items {
        store.set(key, value);
    }
    store
}`

		const chunks = await chunk('store.rs', code)

		expect(chunks.length).toBeGreaterThan(0)

		// All chunks have correct metadata
		for (const c of chunks) {
			expect(c.context.language).toBe('rust')
		}

		// Entities detected (Rust struct may be extracted as 'type' or 'class')
		const allEntities = chunks.flatMap((c) => c.context.entities)
		const entityNames = allEntities.map((e) => e.name)
		expect(entityNames).toContain('Store')

		// Functions detected
		const functions = allEntities.filter((e) => e.type === 'function')
		const functionNames = functions.map((f) => f.name)
		expect(functionNames).toContain('new')
		expect(functionNames).toContain('get')
		expect(functionNames).toContain('set')
		expect(functionNames).toContain('create_store_with')

		// Text matches byte range
		for (const c of chunks) {
			const sliced = code.slice(c.byteRange.start, c.byteRange.end)
			expect(c.text).toBe(sliced)
		}
	})

	test('enums and match expressions', async () => {
		const code = `/// Represents the status of an operation.
#[derive(Debug, Clone, PartialEq)]
pub enum Status {
    Pending,
    Running,
    Completed(String),
    Failed(String),
}

impl Status {
    /// Check if the status represents a terminal state.
    pub fn is_terminal(&self) -> bool {
        matches!(self, Status::Completed(_) | Status::Failed(_))
    }

    /// Get a human-readable description.
    pub fn description(&self) -> &str {
        match self {
            Status::Pending => "Waiting to start",
            Status::Running => "In progress",
            Status::Completed(_) => "Finished successfully",
            Status::Failed(_) => "Finished with error",
        }
    }
}`

		const chunks = await chunk('status.rs', code)

		expect(chunks.length).toBeGreaterThan(0)

		const allEntities = chunks.flatMap((c) => c.context.entities)
		const entityNames = allEntities.map((e) => e.name)

		expect(entityNames).toContain('Status')
		expect(entityNames).toContain('is_terminal')
		expect(entityNames).toContain('description')
	})
})

describe('integration: Go', () => {
	test('full pipeline with struct, methods, and interfaces', async () => {
		const code = `package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ErrNotFound is returned when an entity is not found.
var ErrNotFound = errors.New("entity not found")

// User represents a user in the system.
type User struct {
	ID        int64
	Name      string
	Email     string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// UserRepository defines the interface for user data access.
type UserRepository interface {
	GetByID(ctx context.Context, id int64) (*User, error)
	GetAll(ctx context.Context) ([]*User, error)
	Create(ctx context.Context, user *User) error
	Update(ctx context.Context, user *User) error
	Delete(ctx context.Context, id int64) error
}

// SQLUserRepository implements UserRepository using SQL.
type SQLUserRepository struct {
	db *sql.DB
}

// NewSQLUserRepository creates a new SQL-backed user repository.
func NewSQLUserRepository(db *sql.DB) *SQLUserRepository {
	return &SQLUserRepository{db: db}
}

// GetByID fetches a user by their ID.
func (r *SQLUserRepository) GetByID(ctx context.Context, id int64) (*User, error) {
	user := &User{}
	err := r.db.QueryRowContext(ctx, "SELECT id, name, email, created_at, updated_at FROM users WHERE id = ?", id).
		Scan(&user.ID, &user.Name, &user.Email, &user.CreatedAt, &user.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return user, err
}

// GetAll fetches all users.
func (r *SQLUserRepository) GetAll(ctx context.Context) ([]*User, error) {
	rows, err := r.db.QueryContext(ctx, "SELECT id, name, email, created_at, updated_at FROM users")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		user := &User{}
		if err := rows.Scan(&user.ID, &user.Name, &user.Email, &user.CreatedAt, &user.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}`

		const chunks = await chunk('repository.go', code)

		expect(chunks.length).toBeGreaterThan(0)

		// All chunks have correct metadata
		for (const c of chunks) {
			expect(c.context.language).toBe('go')
		}

		// Types detected
		const allEntities = chunks.flatMap((c) => c.context.entities)
		const typeNames = allEntities.map((e) => e.name)

		expect(typeNames).toContain('User')
		expect(typeNames).toContain('UserRepository')
		expect(typeNames).toContain('SQLUserRepository')

		// Functions detected (standalone functions)
		const goFunctions = allEntities.filter((e) => e.type === 'function')
		const goFunctionNames = goFunctions.map((f) => f.name)
		expect(goFunctionNames).toContain('NewSQLUserRepository')

		// Methods detected (receiver functions)
		const goMethods = allEntities.filter((e) => e.type === 'method')
		const goMethodNames = goMethods.map((m) => m.name)
		expect(goMethodNames).toContain('GetByID')
		expect(goMethodNames).toContain('GetAll')

		// Text matches byte range
		for (const c of chunks) {
			const sliced = code.slice(c.byteRange.start, c.byteRange.end)
			expect(c.text).toBe(sliced)
		}
	})

	test('goroutines and channels', async () => {
		const code = `package worker

import (
	"context"
	"sync"
)

// Job represents a unit of work.
type Job struct {
	ID   int
	Data string
}

// Result represents the result of processing a job.
type Result struct {
	JobID int
	Value string
	Error error
}

// Worker processes jobs from a channel.
func Worker(ctx context.Context, id int, jobs <-chan Job, results chan<- Result, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case job, ok := <-jobs:
			if !ok {
				return
			}
			result := processJob(job)
			results <- result
		}
	}
}

func processJob(job Job) Result {
	return Result{
		JobID: job.ID,
		Value: "processed: " + job.Data,
	}
}`

		const chunks = await chunk('worker.go', code)

		expect(chunks.length).toBeGreaterThan(0)

		const allEntities = chunks.flatMap((c) => c.context.entities)
		const entityNames = allEntities.map((e) => e.name)

		expect(entityNames).toContain('Job')
		expect(entityNames).toContain('Result')
		expect(entityNames).toContain('Worker')
		expect(entityNames).toContain('processJob')
	})
})

describe('integration: Java', () => {
	test('full pipeline with class, methods, and annotations', async () => {
		const code = `package com.example.service;

import java.util.List;
import java.util.Optional;
import java.util.ArrayList;

/**
 * Service for managing user operations.
 * 
 * @author Example
 * @version 1.0
 */
public class UserService {
    private final UserRepository repository;
    private final Logger logger;

    /**
     * Creates a new UserService instance.
     * 
     * @param repository the user repository
     * @param logger the logger instance
     */
    public UserService(UserRepository repository, Logger logger) {
        this.repository = repository;
        this.logger = logger;
    }

    /**
     * Find a user by their unique identifier.
     * 
     * @param id the user's ID
     * @return an Optional containing the user if found
     */
    public Optional<User> findById(Long id) {
        logger.info("Finding user with id: " + id);
        return repository.findById(id);
    }

    /**
     * Get all users in the system.
     * 
     * @return a list of all users
     */
    public List<User> findAll() {
        logger.info("Fetching all users");
        return repository.findAll();
    }

    /**
     * Save a user to the database.
     * 
     * @param user the user to save
     * @return the saved user with generated ID
     */
    public User save(User user) {
        logger.info("Saving user: " + user.getName());
        return repository.save(user);
    }

    /**
     * Delete a user by their ID.
     * 
     * @param id the user's ID
     */
    public void deleteById(Long id) {
        logger.warn("Deleting user with id: " + id);
        repository.deleteById(id);
    }
}

/**
 * Interface for user data access.
 */
interface UserRepository {
    Optional<User> findById(Long id);
    List<User> findAll();
    User save(User user);
    void deleteById(Long id);
}`

		const chunks = await chunk('UserService.java', code)

		expect(chunks.length).toBeGreaterThan(0)

		// All chunks have correct metadata
		for (const c of chunks) {
			expect(c.context.language).toBe('java')
		}

		// Class detected
		const allEntities = chunks.flatMap((c) => c.context.entities)
		const classNames = allEntities
			.filter((e) => e.type === 'class')
			.map((e) => e.name)
		expect(classNames).toContain('UserService')

		// Methods detected
		const methods = allEntities.filter((e) => e.type === 'method')
		const methodNames = methods.map((m) => m.name)
		expect(methodNames).toContain('findById')
		expect(methodNames).toContain('findAll')
		expect(methodNames).toContain('save')
		expect(methodNames).toContain('deleteById')

		// Interface detected
		const interfaces = allEntities.filter((e) => e.type === 'interface')
		expect(interfaces.map((i) => i.name)).toContain('UserRepository')

		// Text matches byte range
		for (const c of chunks) {
			const sliced = code.slice(c.byteRange.start, c.byteRange.end)
			expect(c.text).toBe(sliced)
		}
	})

	test('enum and static methods', async () => {
		const code = `package com.example.model;

/**
 * Represents the status of an order.
 */
public enum OrderStatus {
    PENDING("Waiting for processing"),
    PROCESSING("Being processed"),
    SHIPPED("On the way"),
    DELIVERED("Successfully delivered"),
    CANCELLED("Order cancelled");

    private final String description;

    OrderStatus(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }

    public boolean isTerminal() {
        return this == DELIVERED || this == CANCELLED;
    }

    public static OrderStatus fromString(String status) {
        for (OrderStatus os : values()) {
            if (os.name().equalsIgnoreCase(status)) {
                return os;
            }
        }
        throw new IllegalArgumentException("Unknown status: " + status);
    }
}`

		const chunks = await chunk('OrderStatus.java', code)

		expect(chunks.length).toBeGreaterThan(0)

		const allEntities = chunks.flatMap((c) => c.context.entities)
		const entityNames = allEntities.map((e) => e.name)

		expect(entityNames).toContain('OrderStatus')
		expect(entityNames).toContain('getDescription')
		expect(entityNames).toContain('isTerminal')
		expect(entityNames).toContain('fromString')
	})
})

// ============================================================================
// Cross-Language Tests
// ============================================================================

describe('integration: cross-language', () => {
	test('chunker processes multiple languages sequentially', async () => {
		const files: { path: string; code: string; expectedLang: Language }[] = [
			{
				path: 'utils/math.ts',
				code: `export function add(a: number, b: number): number { return a + b }
export function subtract(a: number, b: number): number { return a - b }`,
				expectedLang: 'typescript',
			},
			{
				path: 'utils/string.py',
				code: `def capitalize(s: str) -> str:
    return s.capitalize()

def lowercase(s: str) -> str:
    return s.lower()`,
				expectedLang: 'python',
			},
			{
				path: 'utils/array.go',
				code: `package utils

func Sum(nums []int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}`,
				expectedLang: 'go',
			},
			{
				path: 'utils/calc.rs',
				code: `pub fn multiply(a: i32, b: i32) -> i32 {
    a * b
}

pub fn divide(a: i32, b: i32) -> Option<i32> {
    if b == 0 { None } else { Some(a / b) }
}`,
				expectedLang: 'rust',
			},
			{
				path: 'Utils.java',
				code: `public class Utils {
    public static int max(int a, int b) {
        return a > b ? a : b;
    }
}`,
				expectedLang: 'java',
			},
			{
				path: 'helpers.js',
				code: `function debounce(fn, delay) {
    let timer
    return function(...args) {
        clearTimeout(timer)
        timer = setTimeout(() => fn.apply(this, args), delay)
    }
}`,
				expectedLang: 'javascript',
			},
		]

		for (const file of files) {
			const chunks = await chunk(file.path, file.code, { maxChunkSize: 300 })

			expect(chunks.length).toBeGreaterThan(0)
			expect(chunks[0]?.context.filepath).toBe(file.path)
			expect(chunks[0]?.context.language).toBe(file.expectedLang)

			// Verify text integrity
			for (const c of chunks) {
				const sliced = file.code.slice(c.byteRange.start, c.byteRange.end)
				expect(c.text).toBe(sliced)
			}
		}
	})
})

// ============================================================================
// Streaming Tests
// ============================================================================

describe('integration: streaming', () => {
	test('stream processes chunks incrementally', async () => {
		const code = `function processItem(item: Item): Result {
  const validated = validate(item)
  const transformed = transform(validated)
  return finalize(transformed)
}

function validate(item: Item): ValidatedItem {
  if (!item.id) throw new Error('Missing id')
  return { ...item, validated: true }
}

function transform(item: ValidatedItem): TransformedItem {
  return { ...item, transformed: true }
}

function finalize(item: TransformedItem): Result {
  return { success: true, data: item }
}`

		const chunks: Chunk[] = []
		for await (const c of chunkStream('pipeline.ts', code, {
			maxChunkSize: 200,
		})) {
			chunks.push(c)

			// In streaming mode, totalChunks is -1 (unknown upfront)
			expect(c.totalChunks).toBe(-1)
			expect(c.index).toBe(chunks.length - 1)
		}

		expect(chunks.length).toBeGreaterThan(0)

		// Verify indices are sequential
		chunks.forEach((c, i) => {
			expect(c.index).toBe(i)
		})
	})

	test('stream for each supported language', async () => {
		const samples: { path: string; code: string }[] = [
			{ path: 'test.ts', code: 'function foo(): number { return 1 }' },
			{ path: 'test.js', code: 'function bar() { return 2 }' },
			{ path: 'test.py', code: 'def baz():\n    return 3' },
			{ path: 'test.rs', code: 'fn qux() -> i32 { 4 }' },
			{ path: 'test.go', code: 'package main\n\nfunc quux() int { return 5 }' },
			{
				path: 'Test.java',
				code: 'public class Test { int corge() { return 6; } }',
			},
		]

		for (const sample of samples) {
			const chunks: Chunk[] = []
			for await (const c of chunkStream(sample.path, sample.code)) {
				chunks.push(c)
			}

			expect(chunks.length).toBeGreaterThan(0)

			// Text reconstruction works
			for (const c of chunks) {
				const sliced = sample.code.slice(c.byteRange.start, c.byteRange.end)
				expect(c.text).toBe(sliced)
			}
		}
	})
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('integration: error handling', () => {
	test('throws for unsupported file extensions', async () => {
		await expect(chunk('file.unsupported', 'code')).rejects.toThrow(
			'Unsupported file type',
		)
	})

	test('stream throws for unsupported file extensions', async () => {
		const collectChunks = async () => {
			const chunks: Chunk[] = []
			for await (const c of chunkStream('file.unsupported', 'code')) {
				chunks.push(c)
			}
			return chunks
		}

		await expect(collectChunks()).rejects.toThrow('Unsupported file type')
	})

	test('handles malformed code gracefully', async () => {
		// Unclosed brace - parser should handle this
		const code = `function broken() {
  return 1`

		// Should not throw, should produce some output
		const chunks = await chunk('test.ts', code)
		expect(chunks.length).toBeGreaterThanOrEqual(0)
	})

	test('handles syntax errors in each language', async () => {
		const malformedSamples: { path: string; code: string }[] = [
			{ path: 'test.ts', code: 'function broken( { return' },
			{ path: 'test.js', code: 'const x =' },
			{ path: 'test.py', code: 'def broken(\n  return' },
			{ path: 'test.rs', code: 'fn broken( -> {' },
			{ path: 'test.go', code: 'func broken( {' },
			{ path: 'Test.java', code: 'public class { int' },
		]

		for (const sample of malformedSamples) {
			// Should not throw - parser recovers
			const chunks = await chunk(sample.path, sample.code)
			expect(chunks).toBeDefined()
		}
	})
})
