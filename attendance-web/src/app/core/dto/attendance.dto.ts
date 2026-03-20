export interface AttendanceRecord {
  row_id?: number;
  id: number;
  name: string;
  timestamp: string;
}

export interface CreateAttendanceRequest {
  employee_id: string;
  name?: string;
  timestamp?: string;
}

export interface UpdateAttendanceRequest {
  employee_id: string;
  name?: string;
  timestamp: string;
}
