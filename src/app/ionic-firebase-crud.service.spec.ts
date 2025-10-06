import { TestBed } from '@angular/core/testing';

import { IonicFirebaseCrudService } from './ionic-firebase-crud.service';

describe('IonicFirebaseCrudService', () => {
  let service: IonicFirebaseCrudService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IonicFirebaseCrudService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
