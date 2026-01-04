/**
 * Request validation middleware
 * Validates incoming requests for common issues
 */

import { Request, Response, NextFunction } from 'express';
import { formatErrorResponse } from '../utils/errors.js';
import { config } from '../config.js';
import { appendFileSync } from 'fs';
import { join } from 'path';

/**
 * Middleware to validate JSON body parsing
 * Catches JSON parsing errors and returns user-friendly messages
 */
export function jsonValidator(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (error instanceof SyntaxError && 'body' in error) {
    const errorResponse = formatErrorResponse(
      error,
      _req.path,
      config.server.nodeEnv === 'development'
    );
    res.status(400).json(errorResponse);
    return;
  }
  next(error);
}

/**
 * Middleware to validate Content-Type for POST/PUT/PATCH requests
 */
export function contentTypeValidator(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const logData = {location:'validator.ts:38',message:'contentTypeValidator entry',data:{method:req.method,path:req.path,contentType:req.get('Content-Type'),headersSent:res.headersSent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
  // #region agent log
  try { appendFileSync(join(process.cwd(), '.cursor', 'debug.log'), JSON.stringify(logData) + '\n'); } catch(e) {}
  fetch('http://127.0.0.1:7244/ingest/b9d8e7ea-3287-4df8-9822-82a2acc3f9c2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(()=>{});
  // #endregion
  
  // Only validate for requests with body
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('Content-Type');
    
    const logData2 = {location:'validator.ts:43',message:'Content-Type check',data:{method:req.method,contentType,isValid:contentType?.includes('application/json')||false,headersSent:res.headersSent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'};
    // #region agent log
    try { appendFileSync(join(process.cwd(), '.cursor', 'debug.log'), JSON.stringify(logData2) + '\n'); } catch(e) {}
    fetch('http://127.0.0.1:7244/ingest/b9d8e7ea-3287-4df8-9822-82a2acc3f9c2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData2)}).catch(()=>{});
    // #endregion
    
    if (!contentType || !contentType.includes('application/json')) {
      const errorResponse = formatErrorResponse(
        new Error('Content-Type must be application/json'),
        req.path,
        config.server.nodeEnv === 'development'
      );
      
      const logData3 = {location:'validator.ts:50',message:'Sending 400 response',data:{headersSent:res.headersSent,statusCode:400,errorMessage:errorResponse.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
      // #region agent log
      try { appendFileSync(join(process.cwd(), '.cursor', 'debug.log'), JSON.stringify(logData3) + '\n'); } catch(e) {}
      fetch('http://127.0.0.1:7244/ingest/b9d8e7ea-3287-4df8-9822-82a2acc3f9c2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData3)}).catch(()=>{});
      // #endregion
      
      res.status(400).json(errorResponse);
      
      const logData4 = {location:'validator.ts:54',message:'After sending 400 response',data:{headersSent:res.headersSent,finished:res.finished},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'};
      // #region agent log
      try { appendFileSync(join(process.cwd(), '.cursor', 'debug.log'), JSON.stringify(logData4) + '\n'); } catch(e) {}
      fetch('http://127.0.0.1:7244/ingest/b9d8e7ea-3287-4df8-9822-82a2acc3f9c2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData4)}).catch(()=>{});
      // #endregion
      
      return;
    }
  }
  
  const logData5 = {location:'validator.ts:60',message:'Calling next()',data:{method:req.method,headersSent:res.headersSent},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
  // #region agent log
  try { appendFileSync(join(process.cwd(), '.cursor', 'debug.log'), JSON.stringify(logData5) + '\n'); } catch(e) {}
  fetch('http://127.0.0.1:7244/ingest/b9d8e7ea-3287-4df8-9822-82a2acc3f9c2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData5)}).catch(()=>{});
  // #endregion
  
  next();
}

