import '@angular/compiler';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach } from 'vitest';

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

/**
 * Angular's TestBed only auto-tears-down between tests when it detects a
 * Jasmine- or Jest-shaped global; it does not detect Vitest, so without
 * this every test after the first sees `configureTestingModule` throw
 * "the test module has already been instantiated".
 */
afterEach(() => {
  TestBed.resetTestingModule();
});
