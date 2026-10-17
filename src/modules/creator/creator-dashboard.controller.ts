// src/modules/creator/creator-dashboard.controller.ts
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/jwt-auth.middleware';
import { sendNotFound, sendSuccess } from '../../utils/api-response.utils';
import {
   getCreatorDashboard,
   KeyNotFoundError,
} from './creator-dashboard.service';

export async function httpGetCreatorDashboard(
   req: AuthenticatedRequest,
   res: Response,
   next: NextFunction
): Promise<void> {
   try {
      const keyId = Array.isArray(req.params.keyId)
         ? req.params.keyId[0]
         : req.params.keyId;
      const dashboard = await getCreatorDashboard(keyId);
      sendSuccess(res, dashboard);
   } catch (error) {
      if (error instanceof KeyNotFoundError) {
         sendNotFound(res, 'Key');
         return;
      }
      next(error);
   }
}
