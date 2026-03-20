export interface EmployeeRecord {
  employee_id: string;
  name: string;
}

export interface RegisterPhotoFile {
  name: string;
  data: string;
}

export interface RegisterPhotosRequest {
  employeeName: string;
  employeeId: string;
  files: RegisterPhotoFile[];
}

export interface RegisterPhotosSavedItem {
  employeeId: string;
  employeeName: string;
  photosProcessed: number;
  failedPhotos: number;
}

export interface RegisterPhotosResponse {
  saved: RegisterPhotosSavedItem[];
  errors: string[];
  qualityWarnings?: string[];
}

export interface EmployeeStorageRecord {
  employee_id: string;
  name: string;
  embedding_bytes: number;
  photo_bytes: number;
  photo_data_url: string;
}
