import { Request, Response, Router } from "express";
import { allowCallers } from "../middlewares/internal-key.middleware";

/**
 * Server-to-server API: called by the customer, partner, rider and POS servers with their own keys,
 * never by a browser. Order lifecycle endpoints land here in the next phase.
 */
const internalRoutes = Router();

internalRoutes.use(allowCallers("customer", "partner", "rider", "pos"));

/** Lets a server check its key and URL are set up: answers with the caller name it was recognised as. */
internalRoutes.get("/whoami", (req: Request, res: Response) => {
  res.json({ caller: req.internalCaller });
});

export default internalRoutes;
