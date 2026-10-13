export interface RoomApiContract {
  createDemo(objective: string): Promise<{ roomId: string }>;
}
