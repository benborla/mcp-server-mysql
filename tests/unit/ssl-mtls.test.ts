import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { readSSLFile } from '../../src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('readSSLFile', () => {
  const validCaPath = path.resolve(__dirname, '../fixtures/valid-ca.pem');
  const validCertPath = path.resolve(__dirname, '../fixtures/valid-client-cert.pem');
  const validKeyPath = path.resolve(__dirname, '../fixtures/valid-client-key.pem');
  const emptyFilePath = path.resolve(__dirname, '../fixtures/empty.pem');
  const nonExistentPath = '/path/to/nonexistent/file.pem';

  describe('with CA certificate files', () => {
    it('should read valid CA PEM file and return Buffer', () => {
      const result = readSSLFile(validCaPath, 'CA certificate');

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);

      const content = result.toString('utf8');
      expect(content).toContain('-----BEGIN CERTIFICATE-----');
      expect(content).toContain('-----END CERTIFICATE-----');
    });
  });

  describe('with client certificate files (mTLS)', () => {
    it('should read valid client certificate PEM file and return Buffer', () => {
      const result = readSSLFile(validCertPath, 'client certificate');

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);

      const content = result.toString('utf8');
      expect(content).toContain('-----BEGIN CERTIFICATE-----');
      expect(content).toContain('-----END CERTIFICATE-----');
    });

    it('should read valid client private key PEM file and return Buffer', () => {
      const result = readSSLFile(validKeyPath, 'client private key');

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);

      const content = result.toString('utf8');
      expect(content).toContain('-----BEGIN PRIVATE KEY-----');
      expect(content).toContain('-----END PRIVATE KEY-----');
    });
  });

  describe('error handling', () => {
    it('should throw clear error for non-existent file', () => {
      expect(() => {
        readSSLFile(nonExistentPath, 'client certificate');
      }).toThrow('SSL client certificate file not found');

      expect(() => {
        readSSLFile(nonExistentPath, 'client certificate');
      }).toThrow(nonExistentPath);
    });

    it('should throw error for empty file', () => {
      expect(() => {
        readSSLFile(emptyFilePath, 'client certificate');
      }).toThrow('SSL client certificate file is empty');

      expect(() => {
        readSSLFile(emptyFilePath, 'client certificate');
      }).toThrow(emptyFilePath);
    });

    it('should include the label in error messages for different file types', () => {
      expect(() => {
        readSSLFile(nonExistentPath, 'client private key');
      }).toThrow('SSL client private key file not found');

      expect(() => {
        readSSLFile(nonExistentPath, 'CA certificate');
      }).toThrow('SSL CA certificate file not found');
    });

    it('should handle relative paths', () => {
      const relativePath = path.relative(process.cwd(), validCertPath);

      const result = readSSLFile(relativePath, 'client certificate');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
