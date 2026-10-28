export class AppError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

export function databaseError(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === '23P01') throw new AppError(409, 'El vehículo ya tiene una reserva activa en ese intervalo');
  if (code === '23505') throw new AppError(409, 'Ya existe un registro con esos datos únicos');
  if (code === '23503') throw new AppError(409, 'La operación tiene referencias inexistentes o registros relacionados');
  if (code === '23514') throw new AppError(409, 'La operación incumple una regla de integridad');
  if (code === '55P03' || code === '57014' || code === '40P01') throw new AppError(503, 'Base ocupada; intente nuevamente');
  throw error;
}
